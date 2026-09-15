import { describe, expect, it } from "vitest";
import {
  computeLootDungeonProfit,
  computeLootTotals,
  getChestExpectedValue,
} from "./calculations";
import type {
  LootCalculatorSettings,
  LootDungeon,
  LootItem,
  LootProbability,
} from "./types";

const items: LootItem[] = [
  { id: "item", name: "Предмет", basePrice: 1000 },
];
const probabilities: LootProbability[] = [
  {
    id: "drop",
    chestId: "daily",
    itemId: "item",
    chancePercent: 50,
    quantity: 2,
  },
  {
    id: "bonus-drop",
    chestId: "bonus",
    itemId: "item",
    chancePercent: 30,
    quantity: 1,
  },
];
const dungeon: LootDungeon = {
  id: "dungeon",
  name: "Тест",
  category: "relic",
  dailyChestId: "daily",
  bonusChestId: "bonus",
  timeMinutes: 10,
};

function settings(
  overrides: Partial<LootCalculatorSettings> = {},
): LootCalculatorSettings {
  return {
    characterCount: 10,
    doubleReward: false,
    selectedDungeonIds: ["dungeon"],
    source: "forecast",
    selectedPackIds: [],
    ...overrides,
  };
}

describe("loot calculator", () => {
  it("calculates a chest by probability, quantity and local price", () => {
    expect(getChestExpectedValue("daily", probabilities, items, [])).toBe(1000);
    expect(
      getChestExpectedValue("daily", probabilities, items, [
        { itemId: "item", price: 2000 },
      ]),
    ).toBe(2000);
  });

  it("doubles only the daily reward and spreads the bonus over three days", () => {
    const regular = computeLootDungeonProfit(
      dungeon,
      settings(),
      probabilities,
      items,
      [],
    );
    const doubled = computeLootDungeonProfit(
      dungeon,
      settings({ doubleReward: true }),
      probabilities,
      items,
      [],
    );

    expect(regular.dailyValue).toBe(10_000);
    expect(regular.bonusValue).toBe(3_000);
    expect(regular.dayValue).toBe(11_000);
    expect(doubled.dailyValue).toBe(20_000);
    expect(doubled.bonusValue).toBe(regular.bonusValue);
  });

  it("totals only selected dungeons", () => {
    const unselected = { ...dungeon, id: "other", name: "Другой" };
    const totals = computeLootTotals(
      settings(),
      [dungeon, unselected],
      probabilities,
      items,
      [],
    );

    expect(totals.rows).toHaveLength(1);
    expect(totals.rows[0]?.dungeonId).toBe("dungeon");
    expect(totals.totalWeekValue).toBe(totals.totalDayValue * 7);
  });

  it("values an existing chest inventory without forecast bonuses", () => {
    const result = computeLootDungeonProfit(
      dungeon,
      settings({
        source: "all_inventory",
        characterCount: 7,
        doubleReward: true,
      }),
      probabilities,
      items,
      [],
    );

    expect(result.dailyValue).toBe(7_000);
    expect(result.bonusValue).toBe(0);
    expect(result.dayValue).toBe(7_000);
    expect(result.weekValue).toBe(7_000);
    expect(result.monthValue).toBe(7_000);
  });

  it("values selected inventory dungeons with their own chest counts", () => {
    const armorDungeon: LootDungeon = {
      ...dungeon,
      id: "armor",
      name: "Доспехи",
      category: "armor",
    };
    const totals = computeLootTotals(
      settings({
        source: "all_inventory",
        selectedDungeonIds: ["dungeon", "armor"],
      }),
      [dungeon, armorDungeon],
      probabilities,
      items,
      [],
      { dungeon: 7, armor: 3 },
    );

    expect(totals.rows).toHaveLength(2);
    expect(totals.totalDayValue).toBe(10_000);
    expect(
      totals.rows.find((row) => row.dungeonId === "dungeon")?.dayValue,
    ).toBe(7_000);
    expect(
      totals.rows.find((row) => row.dungeonId === "armor")?.dayValue,
    ).toBe(3_000);
  });
});
