import { describe, expect, it, vi } from "vitest";
import {
  AdminService,
  type AdminRepository,
} from "./admin-service.js";

function repository(
  overrides: Partial<AdminRepository> = {},
): AdminRepository {
  return {
    searchCreatorRecords: async () => [],
    findCreatorRecord: async () => null,
    grantLifetime: vi.fn(),
    changeSubscription: vi.fn().mockResolvedValue(true),
    cancelSubscription: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("AdminService", () => {
  it("grants only supported manual lifetime sources with a reason", async () => {
    const repo = repository({
      findCreatorRecord: async () => ({
        userId: "9947eea3-28bd-4fcb-98ca-61bc010a5de2",
        email: "creator@example.com",
        creatorIdentityId: "9947eea3-28bd-4fcb-98ca-61bc010a5de2",
        streamingProvider: "twitch",
        streamingChannelId: "123",
        streamingChannelName: "Streamer",
        subscription: null,
      }),
    });
    const service = new AdminService(
      repo,
      () => new Date("2026-07-24T12:00:00Z"),
    );

    await service.grantLifetime(
      "admin-subject",
      "9947eea3-28bd-4fcb-98ca-61bc010a5de2",
      "developer_grant",
      "Demo creator access",
    );

    expect(repo.grantLifetime).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "developer_grant",
        reason: "Demo creator access",
      }),
    );
    await expect(
      service.grantLifetime(
        "admin-subject",
        "9947eea3-28bd-4fcb-98ca-61bc010a5de2",
        "payment",
        "Manual payment",
      ),
    ).rejects.toThrow();
  });

  it("computes a bounded expiry when changing from lifetime to monthly", async () => {
    const repo = repository();
    const service = new AdminService(
      repo,
      () => new Date("2026-07-24T12:00:00Z"),
    );

    await service.changePlan(
      "admin-subject",
      "883613a4-271c-4f6f-9a28-275e8d5c18c4",
      "monthly",
      "Changed by owner",
    );

    expect(repo.changeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "monthly",
        expiresAt: new Date("2026-08-23T12:00:00.000Z"),
      }),
    );
  });
});
