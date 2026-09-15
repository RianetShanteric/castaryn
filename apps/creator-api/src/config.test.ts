import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

const validEnvironment = {
  NODE_ENV: "test",
  CREATOR_DATABASE_URL: "postgres://castaryn:test@localhost:5432/castaryn",
  CREATOR_AUTH_JWKS_URL: "https://identity.example/.well-known/jwks.json",
  CREATOR_AUTH_ISSUER: "https://identity.example/",
  CREATOR_AUTH_AUDIENCE: "castaryn-creator-api",
  ADMIN_AUTH_JWKS_URL:
    "https://admin-identity.example/.well-known/jwks.json",
  ADMIN_AUTH_ISSUER: "https://admin-identity.example/",
  ADMIN_AUTH_AUDIENCE: "castaryn-admin-api",
  ADMIN_ALLOWED_SUBJECTS: "owner-subject",
  ADMIN_ALLOWED_ORIGIN: "https://control.castaryn.example",
  CREATOR_ENCRYPTION_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TWITCH_CLIENT_ID: "twitch-client",
  TWITCH_CLIENT_SECRET: "twitch-secret",
  TWITCH_REDIRECT_URI:
    "https://creator.example/v1/connections/twitch/callback",
  TWITCH_BOT_REDIRECT_URI:
    "https://creator.example/internal/integrations/twitch-bot/callback",
  TWITCH_BOT_USER_ID: "bot-user-id",
  TWITCH_EVENTSUB_CALLBACK_URL:
    "https://creator.example/webhooks/twitch/eventsub",
  TWITCH_EVENTSUB_SECRET: "eventsub-secret-value",
};

describe("Creator API config", () => {
  it("refuses to start without security-critical configuration", () => {
    expect(() => readConfig({})).toThrow();
  });

  it("parses an explicit configuration", () => {
    const config = readConfig(validEnvironment);

    expect(config.environment).toBe("test");
    expect(config.port).toBe(4310);
    expect(config.authJwksUrl.protocol).toBe("https:");
    expect(config.creatorRequireVerifiedEmail).toBe(true);
    expect(config.trustProxyHops).toBe(0);
  });

  it("allows unverified Creator email only when explicitly configured", () => {
    const config = readConfig({
      ...validEnvironment,
      CREATOR_REQUIRE_VERIFIED_EMAIL: "false",
    });

    expect(config.creatorRequireVerifiedEmail).toBe(false);
  });

  it("rejects insecure identity and callback URLs in production", () => {
    expect(() =>
      readConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        CREATOR_AUTH_ISSUER: "http://identity.example/",
        TWITCH_REDIRECT_URI:
          "http://creator.example/v1/connections/twitch/callback",
      }),
    ).toThrow(/must use HTTPS in production/);
  });

  it("leaves YouTube disabled when none of its variables are set", () => {
    const config = readConfig(validEnvironment);
    expect(config.youtube).toBeNull();
    expect(config.youtubePollIntervalMs).toBe(30_000);
  });

  it("refuses a half-configured YouTube integration", () => {
    expect(() =>
      readConfig({
        ...validEnvironment,
        YOUTUBE_CLIENT_ID: "youtube-client",
      }),
    ).toThrow();
  });

  it("enables YouTube once every required variable is set", () => {
    const config = readConfig({
      ...validEnvironment,
      YOUTUBE_CLIENT_ID: "youtube-client",
      YOUTUBE_CLIENT_SECRET: "youtube-secret",
      YOUTUBE_REDIRECT_URI:
        "https://creator.example/v1/connections/youtube/callback",
      YOUTUBE_BOT_REDIRECT_URI:
        "https://creator.example/internal/integrations/youtube-bot/callback",
      YOUTUBE_BOT_CHANNEL_ID: "UCbotchannel",
    });

    expect(config.youtube).toEqual({
      clientId: "youtube-client",
      clientSecret: "youtube-secret",
      redirectUri: "https://creator.example/v1/connections/youtube/callback",
      botRedirectUri:
        "https://creator.example/internal/integrations/youtube-bot/callback",
      botChannelId: "UCbotchannel",
    });
  });

  it("requires Telegram configuration as an all-or-nothing group", () => {
    expect(() =>
      readConfig({
        ...validEnvironment,
        TELEGRAM_BOT_TOKEN:
          "123456789:abcdefghijklmnopqrstuvwxyzABCDEFG",
      }),
    ).toThrow(/Telegram integration is partially configured/);
  });

  it("enables a single allowlisted Telegram owner", () => {
    const config = readConfig({
      ...validEnvironment,
      TELEGRAM_BOT_TOKEN:
        "123456789:abcdefghijklmnopqrstuvwxyzABCDEFG",
      TELEGRAM_ADMIN_USER_ID: "424242",
      TELEGRAM_MINI_APP_URL: "https://control.example/tg/",
    });
    expect(config.telegram).toMatchObject({
      adminUserId: 424242,
      miniAppUrl: new URL("https://control.example/tg/"),
    });
  });
});
