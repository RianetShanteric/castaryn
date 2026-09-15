import type { LootDungeonCategory } from "../features/loot-calculator/types";

export const DAILY_CYCLE_ANCHOR_DAY = "2026-07-30";

export const dailyDungeonCategoryLabels: Record<
  LootDungeonCategory,
  string
> = {
  armor: "Доспехи",
  relic: "Реликвии",
  weapon: "Оружие",
};

const cycle: LootDungeonCategory[] = ["armor", "relic", "weapon"];

function dayNumber(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function getDailyDungeonCategory(
  dayKey: string,
): LootDungeonCategory {
  const offset =
    dayNumber(dayKey) - dayNumber(DAILY_CYCLE_ANCHOR_DAY);
  return cycle[((offset % cycle.length) + cycle.length) % cycle.length]!;
}

export function getDailyDungeonCategoryFromAnchor(
  dayKey: string,
  anchor: { dayKey: string; category: LootDungeonCategory } | null,
): LootDungeonCategory {
  if (!anchor) return getDailyDungeonCategory(dayKey);
  const anchorIndex = cycle.indexOf(anchor.category);
  const offset = dayNumber(dayKey) - dayNumber(anchor.dayKey);
  return cycle[
    ((anchorIndex + offset) % cycle.length + cycle.length) % cycle.length
  ]!;
}

export function getDungeonChestReward(
  dungeonCategory: LootDungeonCategory,
  dailyCategory: LootDungeonCategory,
) {
  return dungeonCategory === dailyCategory ? 3 : 2;
}
