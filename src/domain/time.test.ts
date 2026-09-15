import { describe, expect, it } from "vitest";
import { elapsedSecondsSince } from "./time";

describe("elapsedSecondsSince", () => {
  it("calculates whole elapsed seconds", () => {
    expect(elapsedSecondsSince(1_000, 13_499)).toBe(12);
  });

  it("does not return negative time when the system clock moves backwards", () => {
    expect(elapsedSecondsSince(10_000, 5_000)).toBe(0);
  });

  it("rejects non-finite timestamps", () => {
    expect(elapsedSecondsSince(Number.NaN, 5_000)).toBe(0);
  });
});
