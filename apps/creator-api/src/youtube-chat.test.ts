import { describe, expect, it, vi } from "vitest";
import {
  YoutubeChatClient,
  YoutubeChatPoller,
  YoutubeChatRuntime,
  splitYoutubeChatResponse,
  toYoutubeViewerKey,
} from "./youtube-chat.js";

describe("toYoutubeViewerKey", () => {
  it("lowercases the stable channel id instead of using the display name", () => {
    expect(toYoutubeViewerKey("UCviewer123_-abc")).toBe("ucviewer123_-abc");
  });
});

describe("YoutubeChatClient", () => {
  it("returns null when the channel has no active broadcast", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const client = new YoutubeChatClient(request);

    await expect(client.findActiveLiveChatId("creator-token")).resolves.toBeNull();
  });

  it("only surfaces text messages, ignoring super chats and membership events", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          pollingIntervalMillis: 8000,
          nextPageToken: "page-2",
          items: [
            {
              id: "msg-1",
              snippet: { type: "textMessageEvent", displayMessage: "!баланс" },
              authorDetails: {
                channelId: "UCviewer",
                displayName: "Viewer",
                isChatOwner: false,
                isChatModerator: false,
              },
            },
            {
              id: "msg-2",
              snippet: { type: "superChatEvent" },
              authorDetails: {
                channelId: "UCdonor",
                displayName: "Donor",
                isChatOwner: false,
                isChatModerator: false,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new YoutubeChatClient(request);

    const page = await client.listMessages("bot-token", "chat-1", undefined);

    expect(page.messages).toEqual([
      {
        id: "msg-1",
        authorChannelId: "UCviewer",
        authorDisplayName: "Viewer",
        isChatModerator: false,
        isChatOwner: false,
        text: "!баланс",
      },
    ]);
    expect(page.nextPageToken).toBe("page-2");
    expect(page.pollingIntervalMillis).toBe(8000);
  });

  it("truncates outgoing messages to YouTube's 200-character limit", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const client = new YoutubeChatClient(request);

    await client.sendMessage("bot-token", "chat-1", "x".repeat(500));

    const body = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(body.snippet.textMessageDetails.messageText).toHaveLength(200);
  });
});

describe("splitYoutubeChatResponse", () => {
  it("keeps blocks intact while fitting the 200-character budget", () => {
    const blocks = Array.from(
      { length: 5 },
      (_, index) => `Событие ${index}\n!event${index}\n1000 булочек`,
    );
    const messages = splitYoutubeChatResponse(blocks.join("\n\n"), 60);

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.length <= 60)).toBe(true);
  });
});

describe("YoutubeChatRuntime", () => {
  function runtime(overrides: {
    events?: { respondToChat: ReturnType<typeof vi.fn> };
    features?: { respondToChatCommand: ReturnType<typeof vi.fn> };
  } = {}) {
    const chat = { sendMessage: vi.fn() };
    const features =
      overrides.features ?? { respondToChatCommand: vi.fn().mockResolvedValue(null) };
    const events = overrides.events;
    const instance = new YoutubeChatRuntime(
      features as never,
      chat as never,
      { ensureReady: async () => "bot-token" },
      "UCbot",
      events as never,
    );
    return { instance, chat, features, events };
  }

  it("ignores messages the bot posted itself", async () => {
    const { instance, chat, features } = runtime();

    await instance.handleNotificationPayload({
      channelId: "UCstreamer",
      liveChatId: "chat-1",
      message: {
        id: "msg-1",
        authorChannelId: "UCbot",
        authorDisplayName: "Castaryn Bot",
        isChatModerator: false,
        isChatOwner: false,
        text: "hello",
      },
    });

    expect(features.respondToChatCommand).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("routes through Castaryn Events before custom commands, using the stable channel id as viewer key", async () => {
    const events = { respondToChat: vi.fn().mockResolvedValue("event activated") };
    const { instance, chat, features } = runtime({ events });

    await instance.handleNotificationPayload({
      channelId: "UCstreamer",
      liveChatId: "chat-1",
      message: {
        id: "msg-1",
        authorChannelId: "UCviewer",
        authorDisplayName: "Viewer",
        isChatModerator: false,
        isChatOwner: false,
        text: "!скример",
      },
    });

    expect(events.respondToChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "youtube",
        viewerKey: "ucviewer",
        viewerIsModerator: false,
        text: "!скример",
      }),
    );
    expect(features.respondToChatCommand).not.toHaveBeenCalled();
    expect(chat.sendMessage).toHaveBeenCalledWith(
      "bot-token",
      "chat-1",
      "event activated",
    );
  });

  it("keeps a working, ASCII-safe viewer key for a non-ASCII YouTube display name", async () => {
    const events = { respondToChat: vi.fn().mockResolvedValue(null) };
    const { instance } = runtime({ events });

    await instance.handleNotificationPayload({
      channelId: "UCstreamer",
      liveChatId: "chat-1",
      message: {
        id: "msg-1",
        authorChannelId: "UCviewer",
        authorDisplayName: "Виктор Стример 🎮",
        isChatModerator: false,
        isChatOwner: false,
        text: "!баланс",
      },
    });

    expect(events.respondToChat).toHaveBeenCalledWith(
      expect.objectContaining({ viewerKey: "ucviewer" }),
    );
  });

  it("treats the chat owner as a moderator", async () => {
    const events = { respondToChat: vi.fn().mockResolvedValue(null) };
    const { instance } = runtime({ events });

    await instance.handleNotificationPayload({
      channelId: "UCstreamer",
      liveChatId: "chat-1",
      message: {
        id: "msg-1",
        authorChannelId: "UCstreamer",
        authorDisplayName: "Streamer",
        isChatModerator: false,
        isChatOwner: true,
        text: "!начислить viewer 100",
      },
    });

    expect(events.respondToChat).toHaveBeenCalledWith(
      expect.objectContaining({ viewerIsModerator: true }),
    );
  });
});

describe("YoutubeChatPoller", () => {
  it("backs off for a minute when the channel is not live", async () => {
    const chat = {
      findActiveLiveChatId: vi.fn().mockResolvedValue(null),
      listMessages: vi.fn(),
    };
    const inbox = { enqueue: vi.fn() };
    let now = new Date("2026-07-27T12:00:00.000Z");
    const poller = new YoutubeChatPoller(
      chat as never,
      { ensureReady: async () => "bot-token" },
      inbox as never,
      5_000,
      () => now,
    );
    const target = {
      connectionId: "connection-1",
      externalChannelId: "UCstreamer",
      creatorAccessToken: "creator-token",
    };

    await poller.pollChannel(target);
    expect(chat.findActiveLiveChatId).toHaveBeenCalledTimes(1);

    now = new Date(now.getTime() + 5_000);
    await poller.pollChannel(target);
    expect(chat.findActiveLiveChatId).toHaveBeenCalledTimes(1);
  });

  it("uses the first chat page only as a cursor baseline", async () => {
    const chat = {
      findActiveLiveChatId: vi.fn().mockResolvedValue("chat-1"),
      listMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "msg-1",
            authorChannelId: "UCviewer",
            authorDisplayName: "Viewer",
            isChatModerator: false,
            isChatOwner: false,
            text: "!баланс",
          },
        ],
        nextPageToken: "page-2",
        pollingIntervalMillis: 1_000,
      }),
    };
    const inbox = { enqueue: vi.fn().mockResolvedValue(true) };
    let now = new Date("2026-07-27T12:00:00.000Z");
    const poller = new YoutubeChatPoller(
      chat as never,
      { ensureReady: async () => "bot-token" },
      inbox as never,
      10_000,
      () => now,
    );
    const target = {
      connectionId: "connection-1",
      externalChannelId: "UCstreamer",
      creatorAccessToken: "creator-token",
    };

    const enqueuedCount = await poller.pollChannel(target);

    expect(enqueuedCount).toBe(0);
    expect(inbox.enqueue).not.toHaveBeenCalled();

    // pollingIntervalMillis (1000) is below the configured floor (10000),
    // so the floor should win and a poll one second later should be a no-op.
    now = new Date(now.getTime() + 1_000);
    await poller.pollChannel(target);
    expect(chat.listMessages).toHaveBeenCalledTimes(1);
  });

  it("enqueues only messages received after the baseline page", async () => {
    const chat = {
      findActiveLiveChatId: vi.fn().mockResolvedValue("chat-1"),
      listMessages: vi
        .fn()
        .mockResolvedValueOnce({
          messages: [{ id: "old-message" }],
          nextPageToken: "page-2",
          pollingIntervalMillis: 10_000,
        })
        .mockResolvedValueOnce({
          messages: [
            {
              id: "new-message",
              authorChannelId: "UCviewer",
              authorDisplayName: "Viewer",
              isChatModerator: false,
              isChatOwner: false,
              text: "!баланс",
            },
          ],
          nextPageToken: "page-3",
          pollingIntervalMillis: 10_000,
        }),
    };
    const inbox = { enqueue: vi.fn().mockResolvedValue(true) };
    let now = new Date("2026-07-27T12:00:00.000Z");
    const poller = new YoutubeChatPoller(
      chat as never,
      { ensureReady: async () => "bot-token" },
      inbox as never,
      10_000,
      () => now,
    );
    const target = {
      connectionId: "connection-1",
      externalChannelId: "UCstreamer",
      creatorAccessToken: "creator-token",
    };

    expect(await poller.pollChannel(target)).toBe(0);
    now = new Date(now.getTime() + 10_000);
    expect(await poller.pollChannel(target)).toBe(1);
    expect(inbox.enqueue).toHaveBeenCalledTimes(1);
    expect(inbox.enqueue).toHaveBeenCalledWith(
      "youtube",
      "new-message",
      "notification",
      expect.objectContaining({
        channelId: "UCstreamer",
        liveChatId: "chat-1",
      }),
    );
  });
});
