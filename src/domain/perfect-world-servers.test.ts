import { describe, expect, it } from "vitest";
import {
  isCurrentPerfectWorldServer,
  perfectWorldServers,
} from "./perfect-world-servers";

describe("Perfect World server catalog", () => {
  it("contains the current official servers without duplicates", () => {
    expect(perfectWorldServers).toEqual([
      "Мицар",
      "Центавр",
      "Фенрир",
      "Капелла",
    ]);
    expect(new Set(perfectWorldServers).size).toBe(perfectWorldServers.length);
  });

  it("recognizes only catalog entries", () => {
    expect(isCurrentPerfectWorldServer("Капелла")).toBe(true);
    expect(isCurrentPerfectWorldServer("")).toBe(false);
    expect(isCurrentPerfectWorldServer("Архос")).toBe(false);
  });
});
