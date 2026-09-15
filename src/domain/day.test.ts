import { describe, expect, it } from "vitest";
import { formatHistoryDate, toGameDayKey } from "./day";

describe("day helpers", () => {
  it("uses the Perfect World calendar key", () => {
    expect(toGameDayKey(new Date("2026-07-23T21:30:00.000Z"))).toBe(
      "2026-07-24",
    );
  });

  it("formats a history key for the Russian interface", () => {
    expect(formatHistoryDate("2026-07-24")).toBe("24.07.2026");
  });
});
