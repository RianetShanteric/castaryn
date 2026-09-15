import { describe, expect, it, vi } from "vitest";
import { CreatorAccessService } from "./access-service.js";
import { buildCreatorApi, overlayClientScript } from "./app.js";
import type { AdminService } from "./admin-service.js";
import type { CreatorPlatformService } from "./creator-platform.js";
import type {
  TwitchChatRuntime,
  TwitchEventSubVerifier,
} from "./twitch-chat.js";
import type { SiteAnalyticsService } from "./site-analytics.js";

const identity = {
  subject: "oidc-subject",
  issuer: "https://identity.example/",
  email: "user@example.com",
  emailVerified: true as const,
};

const platformService = {
  ensureAccount: async () => "f7df3642-bcd8-4f11-ac2f-45eb9fdfb3b4",
} as unknown as CreatorPlatformService;

describe("Creator API", () => {
  it("keeps health data minimal", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
    });

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("scopes CORS headers to admin routes only", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      platformService,
      adminAllowedOrigin: "https://admin.example",
      authenticateAdmin: async () => ({
        subject: "admin-1",
        issuer: "https://identity.example/",
        email: "admin@example.com",
        emailVerified: true as const,
      }),
      adminService: {
        search: async () => [],
      } as unknown as AdminService,
    });

    const adminResponse = await app.inject({
      method: "GET",
      url: "/internal/admin/users?query=x",
      headers: {
        authorization: "Bearer admin-token",
        origin: "https://admin.example",
      },
    });
    expect(adminResponse.headers["access-control-allow-origin"]).toBe(
      "https://admin.example",
    );

    const publicResponse = await app.inject({
      method: "GET",
      url: "/v1/creator/access",
      headers: {
        authorization: "Bearer test",
        origin: "https://admin.example",
      },
    });
    expect(
      publicResponse.headers["access-control-allow-origin"],
    ).toBeUndefined();

    await app.close();
  });

  it("accepts site analytics only from the configured site origin", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      siteAllowedOrigin: "https://castaryn.example",
      siteAnalyticsService: {
        record,
      } as unknown as SiteAnalyticsService,
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/site/visit",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      payload: { path: "/" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(record).not.toHaveBeenCalled();

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/site/visit",
      headers: {
        origin: "https://castaryn.example",
        "content-type": "application/json",
      },
      payload: { path: "/" },
    });
    expect(accepted.statusCode).toBe(204);
    expect(accepted.headers["access-control-allow-origin"]).toBe(
      "https://castaryn.example",
    );
    expect(record).toHaveBeenCalledOnce();
    await app.close();
  });

  it("reports an unconfigured YouTube integration without an empty response", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      authenticateAdmin: async () => ({
        subject: "admin-1",
        issuer: "https://identity.example/",
        email: "admin@example.com",
        emailVerified: true as const,
      }),
      adminService: {
        search: async () => [],
      } as unknown as AdminService,
      youtubeConfigured: false,
    });

    const status = await app.inject({
      method: "GET",
      url: "/internal/admin/integrations/youtube-bot",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      configured: false,
      connected: false,
      externalUserId: null,
      scopes: [],
      expiresAt: null,
    });

    const authorize = await app.inject({
      method: "POST",
      url: "/internal/admin/integrations/youtube-bot/authorize",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(authorize.statusCode).toBe(503);
    expect(authorize.json()).toMatchObject({
      error: "integration_not_configured",
    });

    await app.close();
  });

  it("denies Creator access without a valid bearer session", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => {
        throw new Error("invalid");
      },
      platformService,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/creator/access",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: "unauthorized",
      message: "Authentication required",
    });
    await app.close();
  });

  it("returns no features when the user has no active subscription", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      platformService,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/creator/access",
      headers: { authorization: "Bearer test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      active: false,
      creatorIdentityId: null,
      features: [],
      subscription: null,
    });
    await app.close();
  });

  it("does not misreport repository failures as authentication failures", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => {
          throw new Error("database unavailable");
        },
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      platformService,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/creator/access",
      headers: { authorization: "Bearer test" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "internal_error",
      message: "Request could not be completed",
    });
    await app.close();
  });

  it("ships syntactically valid OBS overlay runtime code", () => {
    expect(() => new Function(overlayClientScript)).not.toThrow();
    expect(overlayClientScript).toContain(
      "/events/screamers/screamer-1.webp",
    );
    expect(overlayClientScript).not.toContain("new Audio");
  });

  it("serves the bundled screamer pack to OBS without remote assets", async () => {
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
    });

    const response = await app.inject({
      method: "GET",
      url: "/events/screamers/screamer-1.webp",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/webp");
    expect(response.rawPayload.byteLength).toBeGreaterThan(100_000);
    await app.close();
  });

  it("marks a Twitch EventSub channel ready after a verified challenge", async () => {
    const confirmTwitchEventSub = vi.fn().mockResolvedValue(undefined);
    const app = await buildCreatorApi({
      accessService: new CreatorAccessService({
        findCurrentForUser: async () => null,
        markExpired: async () => undefined,
      }),
      authenticate: async () => identity,
      platformService: {
        confirmTwitchEventSub,
      } as unknown as CreatorPlatformService,
      twitchChatRuntime: {
        parsePayload: () => ({
          challenge: "verified-challenge",
          subscription: {
            type: "channel.chat.message",
            status: "webhook_callback_verification_pending",
            condition: { broadcaster_user_id: "channel-1" },
          },
        }),
      } as unknown as TwitchChatRuntime,
      twitchEventSubVerifier: {
        verify: () => true,
      } as unknown as TwitchEventSubVerifier,
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/twitch/eventsub",
      headers: {
        "content-type": "application/json",
        "twitch-eventsub-message-id": "message-1",
        "twitch-eventsub-message-timestamp": new Date().toISOString(),
        "twitch-eventsub-message-signature": "sha256=test",
        "twitch-eventsub-message-type": "webhook_callback_verification",
      },
      payload: {
        challenge: "verified-challenge",
        subscription: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("verified-challenge");
    expect(confirmTwitchEventSub).toHaveBeenCalledWith("channel-1");
    await app.close();
  });
});
