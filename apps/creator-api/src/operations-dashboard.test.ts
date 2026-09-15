import { describe, expect, it, vi } from "vitest";
import {
  OperationsDashboardService,
  type OperationsRepository,
} from "./operations-dashboard.js";

describe("Operations dashboard", () => {
  it("combines product metrics with a live site probe", async () => {
    const repository: OperationsRepository = {
      readOperationsData: async () => ({
        accounts: { total: 12, today: 2, last7Days: 7 },
        creators: { active: 3, inactive: 1, byPlan: { lifetime: 3 } },
        integrations: [
          {
            provider: "twitch",
            connected: 2,
            ready: 2,
            failed: 0,
            botAuthorized: true,
          },
        ],
        site: {
          viewsToday: 20,
          uniqueToday: 8,
          views7Days: 100,
          unique7Days: 45,
          views30Days: 300,
          unique30Days: 120,
        },
        eventWorkerLastSeenAt: new Date("2026-07-28T11:59:30Z"),
      }),
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const service = new OperationsDashboardService(
      repository,
      new URL("https://castaryn.example"),
      fetcher,
    );

    const snapshot = await service.snapshot(
      new Date("2026-07-28T12:00:00Z"),
    );
    expect(snapshot.site.online).toBe(true);
    expect(snapshot.site.uniqueToday).toBe(8);
    expect(snapshot.system.eventWorkerOnline).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://castaryn.example"),
      expect.objectContaining({ method: "HEAD" }),
    );
  });
});
