import { describe, expect, it, vi } from "vitest";
import {
  ExternalEventWorker,
  type EventInboxRepository,
  type InboxEvent,
} from "./event-inbox.js";
import type { TwitchChatRuntime } from "./twitch-chat.js";

function repositoryWith(events: InboxEvent[]) {
  return {
    enqueue: vi.fn(),
    claim: vi.fn().mockResolvedValue(events),
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
    cleanup: vi.fn(),
  } satisfies EventInboxRepository;
}

describe("ExternalEventWorker", () => {
  it("marks a successfully handled Twitch event as processed", async () => {
    const repository = repositoryWith([
      {
        provider: "twitch",
        messageId: "message-1",
        eventType: "notification",
        payload: { event: "payload" },
        attempts: 1,
      },
    ]);
    const runtime = {
      handleNotificationPayload: vi.fn().mockResolvedValue(undefined),
    } as unknown as TwitchChatRuntime;
    const now = new Date("2026-07-24T20:00:00.000Z");

    await new ExternalEventWorker(
      repository,
      { twitch: runtime },
      () => now,
    ).runOnce();

    expect(runtime.handleNotificationPayload).toHaveBeenCalledOnce();
    expect(repository.markProcessed).toHaveBeenCalledWith(
      "twitch",
      "message-1",
      now,
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("moves a repeatedly failing event to the dead-letter state", async () => {
    const repository = repositoryWith([
      {
        provider: "twitch",
        messageId: "message-2",
        eventType: "notification",
        payload: {},
        attempts: 5,
      },
    ]);
    const runtime = {
      handleNotificationPayload: vi
        .fn()
        .mockRejectedValue(new TypeError("invalid payload")),
    } as unknown as TwitchChatRuntime;

    await new ExternalEventWorker(repository, { twitch: runtime }).runOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twitch",
        messageId: "message-2",
        errorCode: "TypeError",
        deadLetter: true,
      }),
    );
    expect(repository.markProcessed).not.toHaveBeenCalled();
  });
});
