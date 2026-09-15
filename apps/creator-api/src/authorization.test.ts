import { describe, expect, it } from "vitest";
import { can } from "./authorization.js";

describe("Creator authorization", () => {
  it("allows Twitch-badge moderators to configure fixed events", () => {
    expect(can("moderator", "events:view")).toBe(true);
    expect(can("moderator", "events:configure")).toBe(true);
  });

  it("allows moderators to view and preview existing commands", () => {
    expect(can("moderator", "commands:preview")).toBe(true);
  });

  it("keeps owner-only surfaces unavailable to moderators", () => {
    expect(can("moderator", "commands:create")).toBe(false);
    expect(can("moderator", "commands:update")).toBe(false);
    expect(can("moderator", "commands:delete")).toBe(false);
    expect(can("moderator", "overlay:manage")).toBe(false);
    expect(can("moderator", "connections:manage")).toBe(false);
    expect(can("moderator", "events:manage")).toBe(false);
    expect(can("moderator", "events:profile")).toBe(false);
    expect(can("moderator", "events:consume")).toBe(false);
  });
});
