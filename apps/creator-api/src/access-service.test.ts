import { describe, expect, it, vi } from "vitest";
import {
  CreatorAccessService,
  type SubscriptionRepository,
} from "./access-service.js";
import type { CreatorSubscription } from "./domain.js";

const activeLifetime: CreatorSubscription = {
  id: "subscription-1",
  userId: "user-1",
  creatorIdentityId: "creator-1",
  streamingConnectionId: "connection-1",
  plan: "lifetime",
  status: "active",
  source: "developer_grant",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: null,
};

function repositoryWith(
  subscription: CreatorSubscription | null,
): SubscriptionRepository {
  return {
    findCurrentForUser: vi.fn().mockResolvedValue(subscription),
    markExpired: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CreatorAccessService", () => {
  it("returns all Creator capabilities for an active lifetime subscription", async () => {
    const service = new CreatorAccessService(repositoryWith(activeLifetime));

    const access = await service.checkCreatorAccess("user-1");

    expect(access.active).toBe(true);
    expect(access.features).toEqual([
      "chat_commands",
      "moderators",
      "overlay",
      "remote_configuration",
      "events",
    ]);
    expect(access.subscription?.plan).toBe("lifetime");
  });

  it("fails closed when no subscription exists", async () => {
    const service = new CreatorAccessService(repositoryWith(null));

    await expect(service.checkCreatorAccess("user-1")).resolves.toEqual({
      active: false,
      creatorIdentityId: null,
      features: [],
      subscription: null,
    });
  });

  it("expires an elapsed subscription and denies access", async () => {
    const repository = repositoryWith({
      ...activeLifetime,
      plan: "monthly",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const service = new CreatorAccessService(
      repository,
      () => new Date("2026-07-24T00:00:00.000Z"),
    );

    const access = await service.checkCreatorAccess("user-1");

    expect(access.active).toBe(false);
    expect(repository.markExpired).toHaveBeenCalledOnce();
  });
});
