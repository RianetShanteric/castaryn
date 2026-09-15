import { describe, expect, it, vi } from "vitest";
import { AdminApi } from "./api";

const subscription = {
  id: "8cd67b4c-61e3-4e71-9d3f-fb6664dad6f8",
  plan: "lifetime",
  status: "active",
  source: "developer_grant",
  createdAt: "2026-07-24T12:00:00Z",
  expiresAt: null,
};

const record = {
  userId: "f7df3642-bcd8-4f11-ac2f-45eb9fdfb3b4",
  email: "creator@example.com",
  creatorIdentityId: "5c55f46a-3d83-4f1c-a1c0-16b386ba543b",
  streamingProvider: "twitch",
  streamingChannelId: "123",
  streamingChannelName: "streamer",
  subscription,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function apiWithFetch(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return new AdminApi("https://api.example", async () => "admin-token");
}

describe("AdminApi mutations", () => {
  it("parses an explicitly unconfigured YouTube integration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        configured: false,
        connected: false,
        externalUserId: null,
        scopes: [],
        expiresAt: null,
      }),
    );
    const api = apiWithFetch(fetchMock);

    await expect(api.getYoutubeBotStatus()).resolves.toEqual({
      configured: false,
      connected: false,
      externalUserId: null,
      scopes: [],
      expiresAt: null,
    });
  });

  it("sends grantLifetime as an authenticated POST with the source and reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, record));
    const api = apiWithFetch(fetchMock);

    const result = await api.grantLifetime(
      record.userId,
      "developer_grant",
      "Manual Creator access",
    );

    expect(result).toEqual({
      ...record,
      subscription: {
        ...subscription,
        createdAt: new Date(subscription.createdAt),
        expiresAt: null,
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.example/internal/admin/users/${record.userId}/grant-lifetime`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer admin-token");
    expect(JSON.parse(init.body)).toEqual({
      source: "developer_grant",
      reason: "Manual Creator access",
    });
  });

  it("sends changePlan as a PUT to the subscription resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    const api = apiWithFetch(fetchMock);

    await api.changePlan(subscription.id, "yearly", "Downgrade request");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.example/internal/admin/subscriptions/${subscription.id}`,
    );
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      plan: "yearly",
      reason: "Downgrade request",
    });
  });

  it("sends cancel as a POST with the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    const api = apiWithFetch(fetchMock);

    await api.cancel(subscription.id, "Chargeback");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.example/internal/admin/subscriptions/${subscription.id}/cancel`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "Chargeback" });
  });

  it("does not swallow a failed mutation as a success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    const api = apiWithFetch(fetchMock);

    await expect(
      api.cancel(subscription.id, "Chargeback"),
    ).rejects.toThrow("Admin request failed (403)");
  });
});
