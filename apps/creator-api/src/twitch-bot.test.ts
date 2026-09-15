import { describe, expect, it, vi } from "vitest";
import { SecretBox } from "./secret-box.js";
import {
  InvalidTwitchBotOAuthStateError,
  TwitchBotAuthorizationRequiredError,
  TwitchBotService,
  type StoredBotCredential,
  type TwitchBotRepository,
} from "./twitch-bot.js";
import { TwitchClient } from "./twitch-client.js";

function createRepository() {
  let credential: StoredBotCredential | null = null;
  let acceptedState = true;
  return {
    storeState: vi.fn(),
    consumeState: vi.fn(async () => acceptedState),
    upsertCredential: vi.fn(async (input) => {
      credential = {
        externalUserId: input.externalUserId,
        encryptedAccessToken: input.encryptedAccessToken,
        encryptedRefreshToken: input.encryptedRefreshToken,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        invalidatedAt: null,
      };
    }),
    findCredential: vi.fn(async () => credential),
    invalidateCredential: vi.fn(async (now: Date) => {
      if (credential) credential = { ...credential, invalidatedAt: now };
    }),
    rejectState: () => {
      acceptedState = false;
    },
  } satisfies TwitchBotRepository & { rejectState(): void };
}

describe("TwitchBotService", () => {
  it("stores only an encrypted bot grant with the required scopes", async () => {
    const repository = createRepository();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bot-access",
            refresh_token: "bot-refresh",
            expires_in: 3600,
            scope: ["user:bot", "user:read:chat", "user:write:chat"],
            token_type: "bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "client-id",
            user_id: "bot-user",
            login: "castaryn_bot",
            scopes: ["user:bot", "user:read:chat", "user:write:chat"],
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "client-id",
            user_id: "bot-user",
            login: "castaryn_bot",
            scopes: ["user:bot", "user:read:chat", "user:write:chat"],
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
    const box = new SecretBox(Buffer.alloc(32, 9));
    const service = new TwitchBotService(
      repository,
      new TwitchClient(
        {
          clientId: "client-id",
          clientSecret: "secret",
          redirectUri: "https://creator.example/bot/callback",
        },
        request,
      ),
      box,
      "bot-user",
      () => new Date("2026-07-24T20:00:00.000Z"),
    );

    await service.finishAuthorization("code", "state");

    const stored = await repository.findCredential();
    expect(stored?.encryptedAccessToken).not.toContain("bot-access");
    expect(box.decrypt(stored!.encryptedAccessToken)).toBe("bot-access");
    expect(await service.ensureReady()).toBe("bot-access");
  });

  it("rejects expired OAuth state and a grant for another bot", async () => {
    const repository = createRepository();
    repository.rejectState();
    const service = new TwitchBotService(
      repository,
      new TwitchClient({
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/bot/callback",
      }),
      new SecretBox(Buffer.alloc(32, 3)),
      "bot-user",
    );
    await expect(
      service.finishAuthorization("code", "state"),
    ).rejects.toBeInstanceOf(InvalidTwitchBotOAuthStateError);
    await expect(service.ensureReady()).rejects.toBeInstanceOf(
      TwitchBotAuthorizationRequiredError,
    );
  });
});
