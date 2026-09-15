import { describe, expect, it } from "vitest";
import type { User } from "oidc-client-ts";
import { isUsableAdminSession } from "./auth";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    access_token: "token",
    expired: false,
    profile: { sub: "admin-1" },
    ...overrides,
  } as User;
}

describe("isUsableAdminSession", () => {
  it("rejects a missing session", () => {
    expect(isUsableAdminSession(null)).toBe(false);
  });

  it("rejects an expired session even if a token is still present", () => {
    expect(isUsableAdminSession(fakeUser({ expired: true }))).toBe(false);
  });

  it("rejects a session without an access token", () => {
    expect(
      isUsableAdminSession(fakeUser({ access_token: "" })),
    ).toBe(false);
  });

  it("accepts a live session with a token", () => {
    expect(isUsableAdminSession(fakeUser())).toBe(true);
  });
});
