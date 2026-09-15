import { z } from "zod";
import type { CreatorFeaturesService } from "./creator-features.js";
import type { EventsService } from "./events.js";
import type { ExternalEventInbox } from "./event-inbox.js";

const BroadcastListSchema = z.object({
  items: z.array(
    z.object({
      snippet: z.object({ liveChatId: z.string().min(1).optional() }),
    }),
  ),
});

const MessageListSchema = z.object({
  nextPageToken: z.string().optional(),
  pollingIntervalMillis: z.number().int().positive(),
  items: z.array(
    z.object({
      id: z.string().min(1),
      snippet: z.object({
        type: z.string(),
        displayMessage: z.string().optional(),
      }),
      authorDetails: z.object({
        channelId: z.string().min(1),
        displayName: z.string().min(1),
        isChatOwner: z.boolean(),
        isChatModerator: z.boolean(),
      }),
    }),
  ),
});

export type YoutubeChatMessage = {
  id: string;
  authorChannelId: string;
  authorDisplayName: string;
  isChatModerator: boolean;
  isChatOwner: boolean;
  text: string;
};

export class YoutubeChatClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  // Requires the CREATOR's own OAuth token (mine=true resolves to whoever
  // the token belongs to) -- the bot has no standing to discover someone
  // else's active broadcast. Costs far less quota than search.list, which
  // is the other way to find a channel's current live video.
  async findActiveLiveChatId(
    creatorAccessToken: string,
  ): Promise<string | null> {
    const response = await this.request(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&mine=true",
      { headers: { Authorization: `Bearer ${creatorAccessToken}` } },
    );
    if (!response.ok) {
      throw new Error(`YouTube live broadcast lookup failed (${response.status})`);
    }
    const parsed = BroadcastListSchema.parse(await response.json());
    return parsed.items[0]?.snippet.liveChatId ?? null;
  }

  async listMessages(
    botAccessToken: string,
    liveChatId: string,
    pageToken: string | undefined,
  ): Promise<{
    messages: YoutubeChatMessage[];
    nextPageToken: string | undefined;
    pollingIntervalMillis: number;
  }> {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChatMessages");
    url.searchParams.set("liveChatId", liveChatId);
    url.searchParams.set("part", "snippet,authorDetails");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${botAccessToken}` },
    });
    if (!response.ok) {
      throw new Error(`YouTube live chat read failed (${response.status})`);
    }
    const parsed = MessageListSchema.parse(await response.json());
    return {
      messages: parsed.items
        .filter((item) => item.snippet.type === "textMessageEvent")
        .map((item) => ({
          id: item.id,
          authorChannelId: item.authorDetails.channelId,
          authorDisplayName: item.authorDetails.displayName,
          isChatModerator: item.authorDetails.isChatModerator,
          isChatOwner: item.authorDetails.isChatOwner,
          text: item.snippet.displayMessage ?? "",
        })),
      nextPageToken: parsed.nextPageToken,
      pollingIntervalMillis: parsed.pollingIntervalMillis,
    };
  }

  async sendMessage(
    botAccessToken: string,
    liveChatId: string,
    message: string,
  ) {
    const response = await this.request(
      "https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botAccessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            liveChatId,
            type: "textMessageEvent",
            // YouTube live chat messages are capped at 200 characters,
            // shorter than Twitch's ~500 -- the caller is expected to have
            // already split the response with a matching maxLength.
            textMessageDetails: { messageText: message.slice(0, 200) },
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`YouTube chat send failed (${response.status})`);
    }
  }
}

const NotificationSchema = z.object({
  channelId: z.string().min(1),
  liveChatId: z.string().min(1),
  message: z.object({
    id: z.string().min(1),
    authorChannelId: z.string().min(1),
    authorDisplayName: z.string().min(1),
    isChatModerator: z.boolean(),
    isChatOwner: z.boolean(),
    text: z.string(),
  }),
});

export class YoutubeChatRuntime {
  constructor(
    private readonly features: CreatorFeaturesService,
    private readonly chat: YoutubeChatClient,
    private readonly botAuthorization: { ensureReady(): Promise<string> },
    private readonly botChannelId: string,
    private readonly events?: EventsService,
  ) {}

  async handleNotificationPayload(input: unknown) {
    const payload = NotificationSchema.parse(input);
    if (payload.message.authorChannelId === this.botChannelId) return;
    const isModerator =
      payload.message.isChatModerator || payload.message.isChatOwner;
    // YouTube has no separate stable "login" the way Twitch does, but the
    // channel id IS stable and unique -- unlike the display name, which a
    // viewer can change to any (non-unique, non-ASCII) string at will. Using
    // the display name as the balance identity would let one viewer rename
    // into collision with another and share/steal their balance, and would
    // throw on any non-ASCII name (ViewerKeySchema is ASCII-only) for most
    // of this product's Russian-speaking audience. The display name is still
    // used for moderator-typed lookups ("!начислить <ник>"), but only to
    // *resolve* an existing viewer_key (see EventsRepository.resolveViewer),
    // never as the identity itself.
    const viewerKey = toYoutubeViewerKey(payload.message.authorChannelId);
    const eventResponse = await this.events?.respondToChat({
      provider: "youtube",
      externalChannelId: payload.channelId,
      viewerExternalId: payload.message.authorChannelId,
      viewerKey,
      viewerName: payload.message.authorDisplayName,
      viewerIsModerator: isModerator,
      text: payload.message.text,
    });
    const response =
      eventResponse ??
      (await this.features.respondToChatCommand({
        provider: "youtube",
        externalChannelId: payload.channelId,
        chatterUserId: payload.message.authorChannelId,
        chatterIsModerator: isModerator,
        text: payload.message.text,
      }));
    if (response) {
      const botAccessToken = await this.botAuthorization.ensureReady();
      for (const message of splitYoutubeChatResponse(response)) {
        await this.chat.sendMessage(
          botAccessToken,
          payload.liveChatId,
          message,
        );
      }
    }
  }
}

// YouTube channel ids are always `UC` followed by 22 URL-safe characters
// ([A-Za-z0-9_-]) -- lowercasing keeps them within ViewerKeySchema's
// `[a-z0-9_.-]` charset. Collisions between two distinct channel ids after
// lowercasing are cryptographically implausible, unlike display-name
// collisions, which are common and trivially attacker-controlled.
export function toYoutubeViewerKey(channelId: string): string {
  return channelId.toLowerCase();
}

export function splitYoutubeChatResponse(response: string, maxLength = 200) {
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
    let remaining = block;
    while (remaining.length > maxLength) {
      messages.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    current = remaining;
  }
  if (current) messages.push(current);
  return messages;
}

export type YoutubePollTarget = {
  connectionId: string;
  externalChannelId: string;
  creatorAccessToken: string;
};

type PollState = {
  liveChatId: string | null;
  pageToken: string | undefined;
  nextPollAt: number;
  initialized: boolean;
};

export class YoutubeChatPoller {
  private readonly state = new Map<string, PollState>();

  constructor(
    private readonly chat: YoutubeChatClient,
    private readonly botAuthorization: { ensureReady(): Promise<string> },
    private readonly inbox: ExternalEventInbox,
    private readonly minPollIntervalMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async pollChannel(target: YoutubePollTarget): Promise<number> {
    const now = this.now().getTime();
    let entry = this.state.get(target.connectionId);
    if (!entry) {
      entry = {
        liveChatId: null,
        pageToken: undefined,
        nextPollAt: 0,
        initialized: false,
      };
      this.state.set(target.connectionId, entry);
    }
    if (now < entry.nextPollAt) return 0;

    if (!entry.liveChatId) {
      const liveChatId = await this.chat.findActiveLiveChatId(
        target.creatorAccessToken,
      );
      if (!liveChatId) {
        // Not currently live -- checking every minute is plenty and keeps
        // the (tight, quota-limited) polling budget for channels that are
        // actually streaming.
        entry.nextPollAt = now + 60_000;
        return 0;
      }
      entry.liveChatId = liveChatId;
      entry.pageToken = undefined;
      entry.initialized = false;
    }

    const botAccessToken = await this.botAuthorization.ensureReady();
    let page: Awaited<ReturnType<YoutubeChatClient["listMessages"]>>;
    try {
      page = await this.chat.listMessages(
        botAccessToken,
        entry.liveChatId,
        entry.pageToken,
      );
    } catch {
      // The broadcast likely ended or the chat is no longer reachable;
      // rediscover it on the next cycle instead of erroring forever.
      entry.liveChatId = null;
      entry.pageToken = undefined;
      entry.initialized = false;
      entry.nextPollAt = now + 30_000;
      return 0;
    }
    entry.pageToken = page.nextPageToken;
    entry.nextPollAt =
      now + Math.max(this.minPollIntervalMs, page.pollingIntervalMillis);

    // YouTube returns recent chat history on the first request without a
    // pageToken. Treat that response only as a cursor baseline: executing it
    // would replay stale effects and balance commands whenever Castaryn starts
    // or reconnects during an already-running broadcast.
    if (!entry.initialized) {
      entry.initialized = true;
      return 0;
    }

    let enqueued = 0;
    for (const message of page.messages) {
      const accepted = await this.inbox.enqueue(
        "youtube",
        message.id,
        "notification",
        {
          channelId: target.externalChannelId,
          liveChatId: entry.liveChatId,
          message: {
            id: message.id,
            authorChannelId: message.authorChannelId,
            authorDisplayName: message.authorDisplayName,
            isChatModerator: message.isChatModerator,
            isChatOwner: message.isChatOwner,
            text: message.text,
          },
        },
      );
      if (accepted) enqueued += 1;
    }
    return enqueued;
  }
}
