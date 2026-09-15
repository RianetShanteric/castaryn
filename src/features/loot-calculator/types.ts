export interface LootItem {
  id: string;
  name: string;
  basePrice: number;
  icon?: string;
}

export interface LootChest {
  id: string;
  name: string;
}

export interface LootProbability {
  id: string;
  chestId: string;
  itemId: string;
  chancePercent: number;
  quantity: number;
}

export interface LootItemPrice {
  itemId: string;
  price: number;
}

export type LootDungeonCategory = "armor" | "weapon" | "relic";
export type LootCalculationSource =
  | "forecast"
  | "all_inventory"
  | "selected_packs";

export interface LootDungeon {
  id: string;
  name: string;
  category: LootDungeonCategory;
  dailyChestId: string;
  bonusChestId?: string;
  timeMinutes: number;
}

export interface LootCalculatorSettings {
  characterCount: number;
  doubleReward: boolean;
  selectedDungeonIds: string[];
  source: LootCalculationSource;
  selectedPackIds: string[];
}

export interface LootCalculationHistoryEntry {
  id: string;
  createdAt: string;
  characterCount: number;
  doubleReward: boolean;
  selectedDungeons: Array<{ id: string; name: string }>;
  source?: LootCalculationSource;
  inventoryChestCount?: number;
  totalDayValue: number;
  totalWeekValue: number;
  totalMonthValue: number;
}

export type Item = LootItem;
export type Chest = LootChest;
export type DropProbability = LootProbability;
export type Dungeon = LootDungeon;
