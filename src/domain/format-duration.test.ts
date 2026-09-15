import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it.each([
    [0, "00:00:00"],
    [59, "00:00:59"],
    [60, "00:01:00"],
    [3661, "01:01:01"],
  ])("formats %s seconds", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("normalizes invalid negative and fractional input", () => {
    expect(formatDuration(-5)).toBe("00:00:00");
    expect(formatDuration(1.9)).toBe("00:00:01");
  });
});
