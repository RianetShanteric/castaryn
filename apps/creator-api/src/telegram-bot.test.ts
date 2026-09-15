import { describe, expect, it, vi } from "vitest";
import type { OperationsDashboardService } from "./operations-dashboard.js";
import {
  TelegramOperationsRuntime,
  type TelegramAlertRepository,
  type TelegramBotClient,
} from "./telegram-bot.js";

const ADMIN_USER_ID = 123456789;
const MINI_APP_URL = new URL("https://control.castaryn.ru/tg/");

const snapshot = {
  generatedAt: new Date(),
  accounts: { total: 12, today: 2, last7Days: 7 },
  creators: { active: 3, inactive: 1, byPlan: { lifetime: 3 } },
  integrations: [
    {
      provider: "twitch",
      connected: 2,
      ready: 1,
      failed: 1,
      botAuthorized: true,
    },
  ],
  site: {
    viewsToday: 48,
    uniqueToday: 21,
    views7Days: 286,
    unique7Days: 119,
    views30Days: 934,
    unique30Days: 382,
    responseMs: 84,
    online: true,
  },
  system: {
    apiUptimeSeconds: 10,
    memoryUsedPercent: 57.4,
    diskUsedPercent: 51.2,
    eventWorkerOnline: true,
  },
};

function createRuntime(updates: unknown[]) {
  const client = {
    getUpdates: vi.fn().mockResolvedValue(updates),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    configureMenu: vi.fn().mockResolvedValue(undefined),
  };
  const dashboard = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
  };
  const alerts = {
    changeAlertState: vi.fn().mockResolvedValue("unchanged"),
  };
  const runtime = new TelegramOperationsRuntime(
    client as unknown as TelegramBotClient,
    dashboard as unknown as OperationsDashboardService,
    alerts as unknown as TelegramAlertRepository,
    ADMIN_USER_ID,
    MINI_APP_URL,
    new URL("https://api.castaryn.ru/healthz"),
    new URL("https://castaryn.ru"),
  );
  return { runtime, client, dashboard };
}

describe("Telegram owner bot", () => {
  it("configures a default private-chat Mini App menu", async () => {
    const { runtime, client } = createRuntime([]);

    await runtime.configure();

    expect(client.configureMenu).toHaveBeenCalledWith(MINI_APP_URL);
  });

  it("ignores every message from users outside the allowlist", async () => {
    const { runtime, client, dashboard } = createRuntime([
      {
        update_id: 1,
        message: {
          text: "/summary",
          chat: { id: 999 },
          from: { id: 999 },
        },
      },
    ]);

    await runtime.poll();

    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(dashboard.snapshot).not.toHaveBeenCalled();
  });

  it("opens the Mini App for the owner without exposing data in chat", async () => {
    const { runtime, client, dashboard } = createRuntime([
      {
        update_id: 1,
        message: {
          text: "/start",
          chat: { id: ADMIN_USER_ID },
          from: { id: ADMIN_USER_ID },
        },
      },
    ]);

    await runtime.poll();

    expect(client.sendMessage).toHaveBeenCalledWith(
      ADMIN_USER_ID,
      expect.stringContaining("защищённом Mini App"),
      MINI_APP_URL,
    );
    expect(dashboard.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["/status", "всё работает штатно"],
    ["/summary", "Creator worker: онлайн"],
    ["/users", "Всего: 12"],
    ["/creators", "Активны: 3"],
    ["/integrations", "twitch: 1/2 готовы, ошибок 1"],
    ["/site", "21 посетителей"],
  ])("returns the requested owner summary for %s", async (command, expected) => {
    const { runtime, client, dashboard } = createRuntime([
      {
        update_id: 1,
        message: {
          text: command,
          chat: { id: ADMIN_USER_ID },
          from: { id: ADMIN_USER_ID },
        },
      },
    ]);

    await runtime.poll();

    expect(dashboard.snapshot).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledWith(
      ADMIN_USER_ID,
      expect.stringContaining(expected),
      MINI_APP_URL,
    );
  });

  it("does not implement an /events owner command", async () => {
    const { runtime, client, dashboard } = createRuntime([
      {
        update_id: 1,
        message: {
          text: "/events",
          chat: { id: ADMIN_USER_ID },
          from: { id: ADMIN_USER_ID },
        },
      },
    ]);

    await runtime.poll();

    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(dashboard.snapshot).not.toHaveBeenCalled();
  });
});
