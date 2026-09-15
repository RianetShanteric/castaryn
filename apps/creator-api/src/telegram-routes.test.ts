import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CreatorAccessService } from "./access-service.js";
import { buildCreatorApi } from "./app.js";
import type { OperationsDashboardService } from "./operations-dashboard.js";
import type { SiteAnalyticsService } from "./site-analytics.js";

const BOT_TOKEN = "123456:test-token";
const ADMIN_USER_ID = 123456789;
const MINI_APP_URL = new URL("https://control.castaryn.ru/tg/");

function createAccessService() {
  return new CreatorAccessService({
    findCurrentForUser: async () => null,
    markExpired: async () => undefined,
  });
}

function signedInitData(userId: string) {
  const params = new URLSearchParams({
    auth_date: Math.floor(Date.now() / 1_000).toString(),
    query_id: "AAEAAAE",
    user: JSON.stringify({
      id: Number(userId),
      first_name: "Owner",
      username: "owner",
    }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(dataCheckString).digest("hex"),
  );
  return params.toString();
}

describe("Telegram owner routes", () => {
  it("does not expose the operations snapshot without Telegram initData", async () => {
    const snapshot = vi.fn();
    const app = await buildCreatorApi({
      accessService: createAccessService(),
      authenticate: async () => {
        throw new Error("unused");
      },
      operationsService: { snapshot } as unknown as OperationsDashboardService,
      telegram: {
        botToken: BOT_TOKEN,
        adminUserId: ADMIN_USER_ID,
        miniAppUrl: MINI_APP_URL,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/telegram/snapshot",
    });

    expect(response.statusCode).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects valid Telegram data signed for another user", async () => {
    const snapshot = vi.fn();
    const app = await buildCreatorApi({
      accessService: createAccessService(),
      authenticate: async () => {
        throw new Error("unused");
      },
      operationsService: { snapshot } as unknown as OperationsDashboardService,
      telegram: {
        botToken: BOT_TOKEN,
        adminUserId: ADMIN_USER_ID,
        miniAppUrl: MINI_APP_URL,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/telegram/snapshot",
      headers: {
        "x-telegram-init-data": signedInitData("987654321"),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns the snapshot only to the allowlisted Telegram owner", async () => {
    const expected = {
      generatedAt: new Date("2026-07-28T10:00:00.000Z"),
      accounts: { total: 1, today: 0, last7Days: 1 },
      creators: { active: 1, inactive: 0, byPlan: { lifetime: 1 } },
      integrations: [],
      site: {
        viewsToday: 2,
        uniqueToday: 1,
        views7Days: 2,
        unique7Days: 1,
        views30Days: 2,
        unique30Days: 1,
        responseMs: 50,
        online: true,
      },
      system: {
        apiUptimeSeconds: 10,
        memoryUsedPercent: 20,
        diskUsedPercent: 30,
        eventWorkerOnline: true,
      },
    };
    const snapshot = vi.fn().mockResolvedValue(expected);
    const app = await buildCreatorApi({
      accessService: createAccessService(),
      authenticate: async () => {
        throw new Error("unused");
      },
      operationsService: { snapshot } as unknown as OperationsDashboardService,
      telegram: {
        botToken: BOT_TOKEN,
        adminUserId: ADMIN_USER_ID,
        miniAppUrl: MINI_APP_URL,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/telegram/snapshot",
      headers: {
        origin: MINI_APP_URL.origin,
        "x-telegram-init-data": signedInitData(String(ADMIN_USER_ID)),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      MINI_APP_URL.origin,
    );
    expect(response.json()).toMatchObject({
      accounts: expected.accounts,
      site: expected.site,
    });
    expect(snapshot).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe("Public site analytics route", () => {
  it("records a visit without returning analytics data", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const app = await buildCreatorApi({
      accessService: createAccessService(),
      authenticate: async () => {
        throw new Error("unused");
      },
      siteAllowedOrigin: "https://castaryn.ru",
      siteAnalyticsService: { record } as unknown as SiteAnalyticsService,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/site/visit",
      headers: {
        origin: "https://castaryn.ru",
        "user-agent": "Test Browser",
      },
      payload: {
        path: "/download?private=value",
        referrer: "https://example.org/page",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://castaryn.ru",
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: "Test Browser",
        path: "/download?private=value",
      }),
    );
    await app.close();
  });

  it("does not grant a foreign browser CORS access", async () => {
    const app = await buildCreatorApi({
      accessService: createAccessService(),
      authenticate: async () => {
        throw new Error("unused");
      },
      siteAllowedOrigin: "https://castaryn.ru",
      siteAnalyticsService: {
        record: vi.fn().mockResolvedValue(undefined),
      } as unknown as SiteAnalyticsService,
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/site/visit",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
