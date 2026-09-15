import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  TwitchChatClient,
  TwitchChatRuntime,
  TwitchEventSubVerifier,
  splitChatResponse,
} from "./twitch-chat.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("Twitch chat response splitting", () => {
  it("keeps catalog entries intact while fitting Twitch messages", () => {
    const blocks = Array.from(
      { length: 11 },
      (_, index) => `Событие ${index}\n!event${index}\n1000 булочек`,
    );
    const messages = splitChatResponse(blocks.join("\n\n"), 120);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 120)).toBe(true);
    expect(messages.join("\n\n")).toBe(blocks.join("\n\n"));
  });
});

describe("Twitch EventSub verification", () => {
  it("accepts a current valid HMAC and rejects replay-age payloads", () => {
    const secret = "eventsub-secret-value";
    const body = Buffer.from('{"subscription":{"type":"test"}}');
    const messageId = "message-1";
    const timestamp = "2026-07-24T12:00:00.000Z";
    const signature =
      "sha256=" +
      createHmac("sha256", secret)
        .update(messageId)
        .update(timestamp)
        .update(body)
        .digest("hex");
    const headers = {
      messageId,
      timestamp,
      signature,
      messageType: "notification",
    };

    expect(
      new TwitchEventSubVerifier(
        secret,
        () => new Date("2026-07-24T12:05:00.000Z"),
      ).verify(headers, body),
    ).toBe(true);
    expect(
      new TwitchEventSubVerifier(
        secret,
        () => new Date("2026-07-24T12:11:00.000Z"),
      ).verify(headers, body),
    ).toBe(false);
  });
});

describe("TwitchChatRuntime Castaryn Events routing", () => {
  it("routes a real chat notification through Events before custom commands", async () => {
    const features = {
      respondToChatCommand: vi.fn(),
    };
    const chat = {
      botUserId: "bot",
      sendMessage: vi.fn(),
    };
    const events = {
      respondToChat: vi.fn().mockResolvedValue("event activated"),
    };
    const runtime = new TwitchChatRuntime(
      features as never,
      chat as never,
      events as never,
    );

    await runtime.handleNotificationPayload({
      subscription: {
        type: "channel.chat.message",
        status: "enabled",
      },
      event: {
        broadcaster_user_id: "channel",
        chatter_user_id: "viewer-id",
        chatter_user_login: "viewer",
        chatter_user_name: "Viewer",
        message: { text: "!скример" },
        badges: [],
      },
    });

    expect(events.respondToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twitch",
        viewerKey: "viewer",
        text: "!скример",
      }),
    );
    expect(features.respondToChatCommand).not.toHaveBeenCalled();
    expect(chat.sendMessage).toHaveBeenCalledWith(
      "channel",
      "event activated",
    );
  });
});

describe("TwitchChatClient.sendMessage rate-limit backoff", () => {
  function client(request: ReturnType<typeof vi.fn>, sleep: ReturnType<typeof vi.fn>) {
    return new TwitchChatClient(
      {
        clientId: "client",
        clientSecret: "secret",
        botUserId: "bot",
        eventSubCallbackUrl: "https://creator.example/callback",
        eventSubSecret: "eventsub-secret",
      },
      { ensureReady: async () => "ready" },
      request as unknown as typeof fetch,
      () => new Date("2026-07-27T12:00:00Z"),
      sleep as unknown as (ms: number) => Promise<void>,
    );
  }

  it("retries once after a 429 using the Retry-After header, then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "app-token",
          expires_in: 3600,
          token_type: "bearer",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [{ is_sent: true, drop_reason: null }] }),
      );

    await client(request, sleep).sendMessage("channel", "hello");

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting retries and surfaces the failure", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "app-token",
          expires_in: 3600,
          token_type: "bearer",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}));

    await expect(
      client(request, sleep).sendMessage("channel", "hello"),
    ).rejects.toThrow("Twitch chat send failed (429)");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-429 failures", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "app-token",
          expires_in: 3600,
          token_type: "bearer",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(500, {}));

    await expect(
      client(request, sleep).sendMessage("channel", "hello"),
    ).rejects.toThrow("Twitch chat send failed (500)");
    expect(sleep).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
