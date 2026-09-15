// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OperationsSnapshot } from "./api";
import { Dashboard, providerName } from "./main";

const healthySnapshot: OperationsSnapshot = {
  generatedAt: new Date("2026-07-31T07:00:00.000Z"),
  accounts: { total: 12, today: 2, last7Days: 7 },
  creators: {
    active: 3,
    inactive: 1,
    byPlan: { lifetime: 3, trial: 1 },
  },
  integrations: [
    {
      provider: "twitch",
      connected: 2,
      ready: 2,
      failed: 0,
      botAuthorized: true,
    },
    {
      provider: "youtube",
      connected: 1,
      ready: 0,
      failed: 1,
      botAuthorized: false,
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
    apiUptimeSeconds: 91_342,
    memoryUsedPercent: 57.4,
    diskUsedPercent: 51.2,
    eventWorkerOnline: true,
  },
};

describe("Castaryn Control dashboard", () => {
  it("renders the healthy system state and operational metrics", () => {
    render(<Dashboard snapshot={healthySnapshot} />);

    expect(
      screen.getByRole("heading", { name: "Всё работает штатно" }),
    ).toBeDefined();
    expect(screen.getAllByText("21")).toHaveLength(2);
    expect(screen.getByText("84 мс")).toBeDefined();
    expect(screen.getByText("Twitch")).toBeDefined();
    expect(screen.getByText("YouTube")).toBeDefined();
    expect(screen.getByText("1 ошибок")).toBeDefined();
  });

  it("renders a warning when the site or event worker is unavailable", () => {
    render(
      <Dashboard
        snapshot={{
          ...healthySnapshot,
          site: { ...healthySnapshot.site, online: false, responseMs: null },
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Требуется внимание" }),
    ).toBeDefined();
    expect(screen.getByText("Нет связи")).toBeDefined();
    expect(screen.getByText("Недоступен")).toBeDefined();
  });

  it("uses readable names for known streaming providers", () => {
    expect(providerName("twitch")).toBe("Twitch");
    expect(providerName("youtube")).toBe("YouTube");
    expect(providerName("custom")).toBe("custom");
  });
});
