import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { CreatorFeaturesService } from "./creator-features.js";
import type { EventsService } from "./events.js";
import type { StreamingProviderId } from "./streaming-provider.js";

const EventSubPayloadSchema = z.object({
  challenge: z.string().optional(),
  subscription: z.object({
    type: z.string(),
    status: z.string(),
    condition: z
      .object({
        broadcaster_user_id: z.string().optional(),
      })
      .optional(),
  }),
  event: z
    .object({
      broadcaster_user_id: z.string(),
      chatter_user_id: z.string(),
      chatter_user_login: z.string().min(1).max(64).optional(),
      chatter_user_name: z.string().min(1).max(64).optional(),
      message: z.object({ text: z.string().max(500) }),
      badges: z
        .array(
          z.object({
            set_id: z.string(),
          }),
        )
        .default([]),
    })
    .optional(),
});

const AppTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});

const SendMessageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        is_sent: z.boolean(),
        drop_reason: z
          .object({
            code: z.string(),
            message: z.string(),
          })
          .nullable(),
      }),
    )
    .min(1),
});

export type TwitchEventSubHeaders = {
  messageId: string;
  timestamp: string;
  signature: string;
  messageType: string;
};

export class TwitchEventSubVerifier {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length < 10 || secret.length > 100) {
      throw new Error("Twitch EventSub secret must be 10 to 100 characters");
    }
  }

  verify(headers: TwitchEventSubHeaders, rawBody: Buffer) {
    const sentAt = new Date(headers.timestamp);
    if (
      Number.isNaN(sentAt.getTime()) ||
      Math.abs(this.now().getTime() - sentAt.getTime()) > 10 * 60 * 1000
    ) {
      return false;
    }
    const expected =
      "sha256=" +
      createHmac("sha256", this.secret)
        .update(headers.messageId)
        .update(headers.timestamp)
        .update(rawBody)
        .digest("hex");
    const received = Buffer.from(headers.signature);
    const expectedBuffer = Buffer.from(expected);
    return (
      received.length === expectedBuffer.length &&
      timingSafeEqual(received, expectedBuffer)
    );
  }
}
export type TwitchChatSettings = {
  clientId: string;
  clientSecret: string;
  botUserId: string;
  eventSubCallbackUrl: string;
  eventSubSecret: string;
};

// Twitch's chat-send endpoint is rate-limited per bot/channel; a 429 there
// is routine under bursty command usage, not a permanent failure. Retrying
// a couple of times with the server-provided (or a capped exponential)
// backoff avoids sending a transiently-throttled message straight to the
// inbox's slower, coarser retry/dead-letter path.
function retryDelayMs(retryAfterHeader: string | null, attempt: number) {
  const maxDelayMs = 5_000;
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(maxDelayMs, retryAfterSeconds * 1000);
  }
  return Math.min(maxDelayMs, 500 * 2 ** (attempt - 1));
}

export class TwitchChatClient {
  readonly provider = "twitch" satisfies StreamingProviderId;
  private appToken:
    | { value: string; refreshAfter: number }
    | undefined;

  constructor(
    private readonly settings: TwitchChatSettings,
    private readonly botAuthorization: { ensureReady(): Promise<string> },
    private readonly request: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  get botUserId() {
    return this.settings.botUserId;
  }

  async provisionChannel(broadcasterId: string) {
    await this.botAuthorization.ensureReady();
    const accessToken = await this.getAppToken();
    const response = await this.request(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": this.settings.clientId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: broadcasterId,
            user_id: this.settings.botUserId,
          },
          transport: {
            method: "webhook",
            callback: this.settings.eventSubCallbackUrl,
            secret: this.settings.eventSubSecret,
          },
        }),
      },
    );
    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Twitch EventSub provisioning failed (${response.status})`,
      );
    }
    return response.status === 409 ? "ready" as const : "pending" as const;
  }

  async sendMessage(broadcasterId: string, message: string) {
    await this.botAuthorization.ensureReady();
    const accessToken = await this.getAppToken();
    const trimmedMessage = message.slice(0, 500);

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.request(
        "https://api.twitch.tv/helix/chat/messages",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Client-Id": this.settings.clientId,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            broadcaster_id: broadcasterId,
            sender_id: this.settings.botUserId,
            message: trimmedMessage,
          }),
        },
      );
      if (response.status === 429 && attempt < maxAttempts) {
        await this.sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (!response.ok) {
        throw new Error(`Twitch chat send failed (${response.status})`);
      }
      const result = SendMessageResponseSchema.parse(await response.json()).data[0]!;
      if (!result.is_sent) {
        throw new TwitchChatMessageDroppedError(
          result.drop_reason?.code ?? "unknown",
        );
      }
      return;
    }
  }

  private async getAppToken() {
    if (
      this.appToken &&
      this.appToken.refreshAfter > this.now().getTime()
    ) {
      return this.appToken.value;
    }
    const body = new URLSearchParams({
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      grant_type: "client_credentials",
    });
    const response = await this.request(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok) {
      throw new Error(`Twitch app authentication failed (${response.status})`);
    }
    const token = AppTokenSchema.parse(await response.json());
    this.appToken = {
      value: token.access_token,
      refreshAfter:
        this.now().getTime() + Math.max(60, token.expires_in - 300) * 1000,
    };
    return token.access_token;
  }
}

export class TwitchChatRuntime {
  constructor(
    private readonly features: CreatorFeaturesService,
    private readonly chat: TwitchChatClient,
    private readonly events?: EventsService,
  ) {}

  parsePayload(rawBody: Buffer) {
    return EventSubPayloadSchema.parse(JSON.parse(rawBody.toString("utf8")));
  }

  async handleNotification(rawBody: Buffer) {
    return this.handleNotificationPayload(
      JSON.parse(rawBody.toString("utf8")),
    );
  }

  async handleNotificationPayload(input: unknown) {
    const payload = EventSubPayloadSchema.parse(input);
    if (
      payload.subscription.type !== "channel.chat.message" ||
      !payload.event
    ) {
      return;
    }
    const event = payload.event;
    if (event.chatter_user_id === this.chat.botUserId) {
      return;
    }
    const eventResponse = await this.events?.respondToChat({
      provider: "twitch",
      externalChannelId: event.broadcaster_user_id,
      viewerExternalId: event.chatter_user_id,
      viewerKey: event.chatter_user_login ?? event.chatter_user_id,
      viewerName:
        event.chatter_user_name ??
        event.chatter_user_login ??
        event.chatter_user_id,
      viewerIsModerator: event.badges.some(
        (badge) =>
          badge.set_id === "moderator" ||
          badge.set_id === "broadcaster",
      ),
      text: event.message.text,
    });
    const response = eventResponse ?? await this.features.respondToChatCommand({
      provider: "twitch",
      externalChannelId: event.broadcaster_user_id,
      chatterUserId: event.chatter_user_id,
      chatterIsModerator: event.badges.some(
        (badge) =>
          badge.set_id === "moderator" ||
          badge.set_id === "broadcaster",
      ),
      text: event.message.text,
    });
    if (response) {
      for (const message of splitChatResponse(response)) {
        await this.chat.sendMessage(event.broadcaster_user_id, message);
      }
    }
  }
}

export function splitChatResponse(response: string, maxLength = 450) {
  if (response.length <= maxLength) return [response];
  const messages: string[] = [];
  let current = "";
  for (const block of response.split("\n\n")) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current) messages.push(current);
    current = block.slice(0, maxLength);
  }
  if (current) messages.push(current);
  return messages;
}

export class TwitchChatMessageDroppedError extends Error {
  constructor(readonly code: string) {
    super(`Twitch dropped the chat message (${code})`);
  }
}
