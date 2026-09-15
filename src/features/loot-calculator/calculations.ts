import type {
  LootCalculatorSettings,
  LootDungeon,
  LootItem,
  LootItemPrice,
  LootProbability,
} from "./types";

export function getLootItemPrice(
  itemId: string,
  items: LootItem[],
  prices: LootItemPrice[],
): number {
  return (
    prices.find((price) => price.itemId === itemId)?.price ??
    items.find((item) => item.id === itemId)?.basePrice ??
    0
  );
}

export function getChestExpectedValue(
  chestId: string,
  probabilities: LootProbability[],
  items: LootItem[],
  prices: LootItemPrice[],
): number {
  return probabilities
    .filter((probability) => probability.chestId === chestId)
    .reduce(
      (sum, probability) =>
        sum +
        (probability.chancePercent / 100) *
          probability.quantity *
          getLootItemPrice(probability.itemId, items, prices),
      0,
    );
}

export interface LootDungeonProfit {
  dungeonId: string;
  dungeon: LootDungeon;
  dailyValue: number;
  bonusValue: number;
  dayValue: number;
  weekValue: number;
  monthValue: number;
  profitPerMinute: number;
}

export function computeLootDungeonProfit(
  dungeon: LootDungeon,
  settings: LootCalculatorSettings,
  probabilities: LootProbability[],
  items: LootItem[],
  prices: LootItemPrice[],
): LootDungeonProfit {
  const dailyChestValue = getChestExpectedValue(
    dungeon.dailyChestId,
    probabilities,
    items,
    prices,
  );
  const bonusChestValue = dungeon.bonusChestId
    ? getChestExpectedValue(
        dungeon.bonusChestId,
        probabilities,
        items,
        prices,
      )
    : 0;
  const dailyValue =
    dailyChestValue *
    settings.characterCount *
    (settings.source === "forecast" && settings.doubleReward ? 2 : 1);
  const bonusValue =
    settings.source === "forecast"
      ? bonusChestValue * settings.characterCount
      : 0;
  const dayValue =
    settings.source === "forecast" ? dailyValue + bonusValue / 3 : dailyValue;

  return {
    dungeonId: dungeon.id,
    dungeon,
    dailyValue,
    bonusValue,
    dayValue,
    weekValue: settings.source === "forecast" ? dayValue * 7 : dayValue,
    monthValue: settings.source === "forecast" ? dayValue * 30 : dayValue,
    profitPerMinute:
      dungeon.timeMinutes > 0 ? dailyValue / dungeon.timeMinutes : 0,
  };
}

export function computeLootTotals(
  settings: LootCalculatorSettings,
  dungeons: LootDungeon[],
  probabilities: LootProbability[],
  items: LootItem[],
  prices: LootItemPrice[],
  characterCountByDungeonId?: Readonly<Record<string, number>>,
) {
  const selectedIds = new Set(settings.selectedDungeonIds);
  const rows = dungeons
    .filter((dungeon) => selectedIds.has(dungeon.id))
    .map((dungeon) =>
      computeLootDungeonProfit(
        dungeon,
        characterCountByDungeonId
          ? {
              ...settings,
              characterCount: characterCountByDungeonId[dungeon.id] ?? 0,
            }
          : settings,
        probabilities,
        items,
        prices,
      ),
    )
    .sort((left, right) => right.dayValue - left.dayValue);

  return {
    rows,
    totalDayValue: rows.reduce((sum, row) => sum + row.dayValue, 0),
    totalWeekValue: rows.reduce((sum, row) => sum + row.weekValue, 0),
    totalMonthValue: rows.reduce((sum, row) => sum + row.monthValue, 0),
  };
}
