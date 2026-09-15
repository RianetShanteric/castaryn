import { describe, expect, it, vi } from "vitest";
import { SecretBox } from "./secret-box.js";
import {
  InvalidYoutubeBotOAuthStateError,
  YoutubeBotAuthorizationRequiredError,
  YoutubeBotService,
  type StoredYoutubeBotCredential,
  type YoutubeBotRepository,
} from "./youtube-bot.js";
import { YoutubeClient } from "./youtube-client.js";

function createRepository() {
  let credential: StoredYoutubeBotCredential | null = null;
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
  } satisfies YoutubeBotRepository & { rejectState(): void };
}

const botScope = "https://www.googleapis.com/auth/youtube.force-ssl";

describe("YoutubeBotService", () => {
  it("stores only an encrypted bot grant matching the expected channel", async () => {
    const repository = createRepository();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bot-access",
            refresh_token: "bot-refresh",
            expires_in: 3600,
            scope: botScope,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            aud: "client-id",
            scope: botScope,
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "UCbotchannel",
                snippet: { title: "Castaryn Bot" },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            aud: "client-id",
            scope: botScope,
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
    const box = new SecretBox(Buffer.alloc(32, 9));
    const service = new YoutubeBotService(
      repository,
      new YoutubeClient(
        {
          clientId: "client-id",
          clientSecret: "secret",
          redirectUri: "https://creator.example/youtube-bot/callback",
        },
        request,
      ),
      box,
      "UCbotchannel",
      () => new Date("2026-07-24T20:00:00.000Z"),
    );

    await service.finishAuthorization("code", "state");

    const stored = await repository.findCredential();
    expect(stored?.encryptedAccessToken).not.toContain("bot-access");
    expect(box.decrypt(stored!.encryptedAccessToken)).toBe("bot-access");
    expect(await service.ensureReady()).toBe("bot-access");
  });

  it("rejects a grant authorized under the wrong YouTube channel", async () => {
    const repository = createRepository();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "bot-access",
            refresh_token: "bot-refresh",
            expires_in: 3600,
            scope: botScope,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            aud: "client-id",
            scope: botScope,
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: "UCsomeoneElse", snippet: { title: "Not the bot" } },
            ],
          }),
          { status: 200 },
        ),
      );
    const service = new YoutubeBotService(
      repository,
      new YoutubeClient(
        {
          clientId: "client-id",
          clientSecret: "secret",
          redirectUri: "https://creator.example/youtube-bot/callback",
        },
        request,
      ),
      new SecretBox(Buffer.alloc(32, 3)),
      "UCbotchannel",
    );

    await expect(
      service.finishAuthorization("code", "state"),
    ).rejects.toBeInstanceOf(YoutubeBotAuthorizationRequiredError);
  });

  it("rejects expired OAuth state and a missing grant", async () => {
    const repository = createRepository();
    repository.rejectState();
    const service = new YoutubeBotService(
      repository,
      new YoutubeClient({
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/youtube-bot/callback",
      }),
      new SecretBox(Buffer.alloc(32, 3)),
      "UCbotchannel",
    );
    await expect(
      service.finishAuthorization("code", "state"),
    ).rejects.toBeInstanceOf(InvalidYoutubeBotOAuthStateError);
    await expect(service.ensureReady()).rejects.toBeInstanceOf(
      YoutubeBotAuthorizationRequiredError,
    );
  });
});
