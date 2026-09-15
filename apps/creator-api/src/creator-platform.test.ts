import { describe, expect, it, vi } from "vitest";
import {
  CreatorPlatformService,
  type CreatorPlatformRepository,
} from "./creator-platform.js";
import { SecretBox } from "./secret-box.js";
import { TwitchClient } from "./twitch-client.js";

function repository(): CreatorPlatformRepository {
  return {
    ensureAccount: vi.fn().mockResolvedValue(
      "8cd67b4c-61e3-4e71-9d3f-fb6664dad6f8",
    ),
    storeOAuthState: vi.fn(),
    consumeOAuthState: vi.fn(),
    upsertTwitchConnection: vi.fn(),
    findTwitchConnection: vi.fn(),
    disconnectTwitch: vi.fn(),
    listTwitchCredentials: async () => [],
    updateTwitchCredential: vi.fn(),
    invalidateTwitchConnection: vi.fn(),
    updateTwitchEventSubStatus: vi.fn(),
    confirmTwitchEventSub: vi.fn(),
    upsertYoutubeConnection: vi.fn(),
    findYoutubeConnection: vi.fn(),
    disconnectYoutube: vi.fn(),
    listYoutubeCredentials: async () => [],
    updateYoutubeCredential: vi.fn(),
    invalidateYoutubeConnection: vi.fn(),
  };
}

describe("CreatorPlatformService", () => {
  it("allows channel connection before access is granted and stores only a state hash", async () => {
    const repo = repository();
    const service = new CreatorPlatformService(
      repo,
      new TwitchClient({
        clientId: "client",
        clientSecret: "secret",
        redirectUri: "https://creator.example/callback",
      }),
      new SecretBox(Buffer.alloc(32, 3)),
      () => new Date("2026-07-24T12:00:00Z"),
    );

    const authorizeUrl = new URL(
      await service.beginTwitchConnection("user-1"),
    );
    const rawState = authorizeUrl.searchParams.get("state")!;
    const stored = vi.mocked(repo.storeOAuthState).mock.calls[0]?.[0];

    expect(stored?.stateHash).not.toBe(rawState);
    expect(stored?.stateHash).toHaveLength(43);
    expect(stored?.expiresAt.toISOString()).toBe(
      "2026-07-24T12:10:00.000Z",
    );
  });

  it("records EventSub readiness after connecting a Twitch channel", async () => {
    const repo = repository();
    vi.mocked(repo.consumeOAuthState).mockResolvedValue({
      userId: "user-1",
      provider: "twitch",
      expiresAt: new Date("2026-07-24T12:10:00Z"),
    });
    vi.mocked(repo.upsertTwitchConnection).mockResolvedValue({
      connectionId: "connection-1",
      id: "channel-1",
      login: "streamer",
      displayName: "Streamer",
      connectedAt: new Date("2026-07-24T12:00:00Z"),
    });
    const twitch = {
      exchangeCode: vi.fn().mockResolvedValue({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: new Date("2026-07-24T13:00:00Z"),
        scopes: ["channel:bot"],
      }),
      validate: vi.fn().mockResolvedValue({
        user_id: "channel-1",
        scopes: ["channel:bot"],
      }),
      getCurrentChannel: vi.fn().mockResolvedValue({
        id: "channel-1",
        login: "streamer",
        displayName: "Streamer",
      }),
    } as unknown as TwitchClient;
    const provisioner = {
      provider: "twitch" as const,
      provisionChannel: vi.fn().mockResolvedValue("pending" as const),
    };
    const service = new CreatorPlatformService(
      repo,
      twitch,
      new SecretBox(Buffer.alloc(32, 3)),
      () => new Date("2026-07-24T12:00:00Z"),
      provisioner,
    );

    await service.finishTwitchConnection("code", "state");

    expect(provisioner.provisionChannel).toHaveBeenCalledWith("channel-1");
    expect(repo.updateTwitchEventSubStatus).toHaveBeenCalledWith(
      "connection-1",
      "pending",
      new Date("2026-07-24T12:00:00Z"),
    );
  });
});
