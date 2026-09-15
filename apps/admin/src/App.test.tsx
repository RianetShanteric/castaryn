import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User, UserManager } from "oidc-client-ts";
import { App } from "./App";

vi.mock("./auth", async () => {
  const actual = await vi.importActual<typeof import("./auth")>("./auth");
  return {
    ...actual,
    readRuntimeConfig: vi.fn(() => ({
      authority: "https://identity.example",
      clientId: "admin",
      audience: "admin-api",
      apiUrl: "https://api.example",
    })),
    createAdminUserManager: vi.fn(),
  };
});

type Listener = (...args: unknown[]) => void;

function fakeManager(user: User | null) {
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string) => (fn: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
  };
  const off = (name: string) => (fn: Listener) => {
    listeners.get(name)?.delete(fn);
  };
  const emit = (name: string, ...args: unknown[]) => {
    for (const fn of listeners.get(name) ?? []) fn(...args);
  };
  const manager = {
    getUser: vi.fn().mockResolvedValue(user),
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
    signinRedirectCallback: vi.fn(),
    events: {
      addAccessTokenExpiring: on("expiring"),
      removeAccessTokenExpiring: off("expiring"),
      addAccessTokenExpired: on("expired"),
      removeAccessTokenExpired: off("expired"),
      addUserSignedOut: on("signedOut"),
      removeUserSignedOut: off("signedOut"),
      addUserUnloaded: on("unloaded"),
      removeUserUnloaded: off("unloaded"),
      addUserLoaded: on("loaded"),
      removeUserLoaded: off("loaded"),
    },
  } as unknown as UserManager;
  return { manager, emit };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    access_token: "token",
    expired: false,
    profile: { sub: "admin-1", email: "admin@example.com" },
    ...overrides,
  } as User;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App session gating", () => {
  it("shows the login gate when there is no admin session", async () => {
    const auth = await import("./auth");
    const { manager } = fakeManager(null);
    vi.mocked(auth.createAdminUserManager).mockReturnValue(manager);

    render(<App />);

    expect(
      await screen.findByText("Castaryn Control"),
    ).toBeTruthy();
    expect(screen.getByText("Войти безопасно")).toBeTruthy();
  });

  it("warns and offers re-login once the session starts expiring", async () => {
    const auth = await import("./auth");
    const { manager, emit } = fakeManager(fakeUser());
    vi.mocked(auth.createAdminUserManager).mockReturnValue(manager);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          connected: false,
          externalUserId: null,
          scopes: [],
          expiresAt: null,
        }),
      }),
    );

    render(<App />);
    await waitFor(() => expect(manager.getUser).toHaveBeenCalled());
    expect(await screen.findByText(/admin@example.com/)).toBeTruthy();

    expect(screen.queryByText(/Сессия скоро истечёт/)).toBeNull();
    emit("expiring");
    expect(
      await screen.findByText(/Сессия скоро истечёт/),
    ).toBeTruthy();

    screen.getByText("Войти заново").click();
    expect(manager.signinRedirect).toHaveBeenCalled();
  });

  it("drops back to the login gate once the token actually expires", async () => {
    const auth = await import("./auth");
    const { manager, emit } = fakeManager(fakeUser());
    vi.mocked(auth.createAdminUserManager).mockReturnValue(manager);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          connected: false,
          externalUserId: null,
          scopes: [],
          expiresAt: null,
        }),
      }),
    );

    render(<App />);
    await waitFor(() => expect(manager.getUser).toHaveBeenCalled());
    expect(await screen.findByText(/admin@example.com/)).toBeTruthy();

    emit("expired");

    expect(await screen.findByText("Войти безопасно")).toBeTruthy();
  });
});

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

const recordA = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "creator-a@example.com",
  creatorIdentityId: "21111111-1111-4111-8111-111111111111",
  streamingProvider: "twitch",
  streamingChannelId: "channel-a",
  streamingChannelName: "Creator A",
  subscription: {
    id: "31111111-1111-4111-8111-111111111111",
    plan: "trial",
    status: "active",
    source: "payment",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
  },
};
const recordB = {
  userId: "12222222-1111-4111-8111-111111111111",
  email: "creator-b@example.com",
  creatorIdentityId: "22222222-1111-4111-8111-111111111111",
  streamingProvider: "youtube",
  streamingChannelId: "channel-b",
  streamingChannelName: "Creator B",
  subscription: {
    id: "32222222-1111-4111-8111-111111111111",
    plan: "yearly",
    status: "active",
    source: "payment",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};

async function renderSignedInAdmin() {
  const auth = await import("./auth");
  const { manager } = fakeManager(fakeUser());
  vi.mocked(auth.createAdminUserManager).mockReturnValue(manager);
  render(<App />);
  await waitFor(() => expect(manager.getUser).toHaveBeenCalled());
  expect(await screen.findByText(/admin@example.com/)).toBeTruthy();
  return manager;
}

async function search() {
  fireEvent.change(screen.getByLabelText("Поиск пользователя"), {
    target: { value: "creator" },
  });
  fireEvent.click(screen.getByText("Найти"));
  await screen.findByText("Creator A");
}

describe("Creator search & edit workflow", () => {
  it("resets the plan form when switching between search results without saving", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.startsWith("/internal/admin/integrations/")) {
        return jsonResponse({
          connected: false,
          externalUserId: null,
          scopes: [],
          expiresAt: null,
        });
      }
      if (url.pathname === "/internal/admin/users" && method === "GET") {
        return jsonResponse([recordA, recordB]);
      }
      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderSignedInAdmin();
    await search();

    fireEvent.click(screen.getByText("Creator A"));
    const planSelect = (await screen.findByLabelText(
      "Тип доступа",
    )) as HTMLSelectElement;
    expect(planSelect.value).toBe("trial");

    // Edit the plan for A but never save it, then switch to B.
    fireEvent.change(planSelect, { target: { value: "lifetime" } });
    expect(planSelect.value).toBe("lifetime");

    fireEvent.click(screen.getByText("Creator B"));
    const planSelectAfterSwitch = (await screen.findByLabelText(
      "Тип доступа",
    )) as HTMLSelectElement;
    // Without a `key` on CreatorCard, React reuses the old form instance and
    // this would still read back "lifetime" -- A's unsaved edit -- instead
    // of B's actual plan.
    expect(planSelectAfterSwitch.value).toBe("yearly");
  });

  it("keeps the results list in sync after a mutation on the selected creator", async () => {
    const cancelledRecordA = {
      ...recordA,
      subscription: { ...recordA.subscription, status: "cancelled" },
    };
    let getUserCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.startsWith("/internal/admin/integrations/")) {
        return jsonResponse({
          connected: false,
          externalUserId: null,
          scopes: [],
          expiresAt: null,
        });
      }
      if (url.pathname === "/internal/admin/users" && method === "GET") {
        // Two results, so nothing auto-selects and "Creator A" only ever
        // matches the results-list row -- selecting it below is what
        // renders the second ("Creator A" in the CreatorCard heading) copy.
        return jsonResponse([recordA, recordB]);
      }
      if (
        url.pathname === `/internal/admin/users/${recordA.userId}` &&
        method === "GET"
      ) {
        getUserCalls += 1;
        // The only getUser call for A happens from refreshSelected() after
        // the cancel below succeeds -- it should already reflect the new
        // status by then.
        return jsonResponse(getUserCalls > 0 ? cancelledRecordA : recordA);
      }
      if (
        url.pathname ===
          `/internal/admin/subscriptions/${recordA.subscription.id}/cancel` &&
        method === "POST"
      ) {
        return jsonResponse(undefined);
      }
      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderSignedInAdmin();
    await search();

    fireEvent.click(screen.getByText("Creator A"));
    await screen.findByLabelText("Тип доступа");
    fireEvent.change(screen.getByLabelText("Причина изменения"), {
      target: { value: "Integration test cancel" },
    });
    fireEvent.click(screen.getByText("Отключить"));

    await waitFor(() => expect(getUserCalls).toBeGreaterThan(0));
    await waitFor(() => {
      const row = document.querySelector(".result-row");
      const dot = row?.querySelector("i");
      expect(dot?.className).not.toContain("status-dot--active");
    });
  });
});
