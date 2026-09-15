import { describe, expect, it } from "vitest";
import {
  fetchCreatorAccess,
  loadCreatorRuntimeConfig,
  parseCreatorAccess,
  playerAccess,
} from "./creator-client";

describe("Creator client", () => {
  it("fails closed to Player when no desktop session exists", async () => {
    await expect(fetchCreatorAccess()).resolves.toEqual(playerAccess);
  });

  it("keeps browser preview disconnected from Creator infrastructure", async () => {
    await expect(loadCreatorRuntimeConfig()).resolves.toEqual({
      configured: false,
      apiUrl: null,
      oidcAuthority: null,
      oidcClientId: null,
      oidcAudience: null,
    });
  });

  it("rejects an invalid feature response", () => {
    expect(() =>
      parseCreatorAccess({
        active: true,
        features: ["unknown_feature"],
        subscription: null,
      }),
    ).toThrow();
  });
});
