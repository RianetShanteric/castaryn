import { describe, expect, it, vi } from "vitest";
import {
  SiteAnalyticsService,
  type SiteAnalyticsRepository,
} from "./site-analytics.js";

describe("Site analytics", () => {
  it("stores a rotating pseudonymous hash without raw IP or user agent", async () => {
    const recordVisit = vi.fn().mockResolvedValue(undefined);
    const service = new SiteAnalyticsService(
      { recordVisit } as SiteAnalyticsRepository,
      "a-private-analytics-secret-with-more-than-32-bytes",
    );
    const input = {
      ip: "203.0.113.7",
      userAgent: "Sensitive browser fingerprint",
      path: "/?utm_source=test",
      referrer: "https://example.org/private/path",
    };

    await service.record({
      ...input,
      now: new Date("2026-07-28T10:00:00Z"),
    });
    await service.record({
      ...input,
      now: new Date("2026-07-28T18:00:00Z"),
    });

    const first = recordVisit.mock.calls[0]![0];
    const second = recordVisit.mock.calls[1]![0];
    expect(first.visitorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.visitorHash).toBe(second.visitorHash);
    expect(first.path).toBe("/");
    expect(first.referrerHost).toBe("example.org");
    expect(JSON.stringify(first)).not.toContain(input.ip);
    expect(JSON.stringify(first)).not.toContain(input.userAgent);
  });

  it("changes the identifier on the next day", async () => {
    const recordVisit = vi.fn().mockResolvedValue(undefined);
    const service = new SiteAnalyticsService(
      { recordVisit } as SiteAnalyticsRepository,
      "a-private-analytics-secret-with-more-than-32-bytes",
    );
    const base = { ip: "203.0.113.7", userAgent: "Browser", path: "/" };
    await service.record({
      ...base,
      now: new Date("2026-07-28T23:59:00Z"),
    });
    await service.record({
      ...base,
      now: new Date("2026-07-29T00:01:00Z"),
    });
    expect(recordVisit.mock.calls[0]![0].visitorHash).not.toBe(
      recordVisit.mock.calls[1]![0].visitorHash,
    );
  });
});
