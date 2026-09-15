import { describe, expect, it } from "vitest";
import {
  getDailyDungeonCategory,
  getDailyDungeonCategoryFromAnchor,
  getDungeonChestReward,
} from "./daily-dungeon-cycle";

describe("Perfect World daily dungeon cycle", () => {
  it("uses 30 July 2026 as the armor anchor", () => {
    expect(getDailyDungeonCategory("2026-07-30")).toBe("armor");
    expect(getDailyDungeonCategory("2026-07-31")).toBe("relic");
    expect(getDailyDungeonCategory("2026-08-01")).toBe("weapon");
    expect(getDailyDungeonCategory("2026-08-02")).toBe("armor");
  });

  it("works for dates before the anchor", () => {
    expect(getDailyDungeonCategory("2026-07-29")).toBe("weapon");
  });

  it("adds one chest only for the active daily category", () => {
    expect(getDungeonChestReward("armor", "armor")).toBe(3);
    expect(getDungeonChestReward("weapon", "armor")).toBe(2);
  });

  it("continues the cycle from a manually corrected day", () => {
    const anchor = { dayKey: "2026-08-01", category: "armor" as const };
    expect(getDailyDungeonCategoryFromAnchor("2026-08-01", anchor)).toBe(
      "armor",
    );
    expect(getDailyDungeonCategoryFromAnchor("2026-08-02", anchor)).toBe(
      "relic",
    );
    expect(getDailyDungeonCategoryFromAnchor("2026-08-03", anchor)).toBe(
      "weapon",
    );
  });
});
