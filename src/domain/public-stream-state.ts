import type { PublicStreamState } from "../lib/creator-client";
import {
  getPackChestTotal,
  type Pack,
  type Profile,
} from "../store/castaryn-store";
import type { LootDungeonCategory } from "../features/loot-calculator/types";
import {
  dailyDungeonCategoryLabels,
  getDailyDungeonCategoryFromAnchor,
} from "./daily-dungeon-cycle";

export function buildPublicStreamState(input: {
  packs: Pack[];
  activeRun: {
    packId: string;
    dungeonId: string;
    elapsedSeconds: number;
  } | null;
  profile: Profile;
  dayKey: string;
  dailyCategoryOverride: {
    dayKey: string;
    category: LootDungeonCategory;
  } | null;
}): PublicStreamState {
  const enabledPacks = input.packs.filter((pack) => pack.enabled);
  const completedDungeons = enabledPacks.flatMap((pack) =>
    pack.dungeons.filter((dungeon) => dungeon.status === "completed"),
  );
  const totalDungeons = enabledPacks.reduce(
    (sum, pack) => sum + pack.dungeons.length,
    0,
  );
  const completedPacks = enabledPacks.filter(
    (pack) =>
      pack.completedManually ||
      pack.dungeons.every((dungeon) => dungeon.status === "completed"),
  ).length;
  const activePack = input.activeRun
    ? input.packs.find((pack) => pack.id === input.activeRun?.packId)
    : null;
  const activeDungeon = activePack?.dungeons.find(
    (dungeon) => dungeon.id === input.activeRun?.dungeonId,
  );
  const routePack =
    activePack ??
    enabledPacks.find((pack) =>
      pack.dungeons.some((dungeon) => dungeon.status === "idle"),
    );
  const nextDungeon =
    routePack?.dungeons.find((dungeon) => dungeon.status === "idle") ?? null;
  const dailyCategory = getDailyDungeonCategoryFromAnchor(
    input.dayKey,
    input.dailyCategoryOverride,
  );

  return {
    activity: input.activeRun ? "Perfect World PvE" : null,
    pack: activePack?.name ?? null,
    dungeon: activeDungeon?.name ?? null,
    nextDungeon: nextDungeon?.name ?? null,
    dailyQuest: dailyDungeonCategoryLabels[dailyCategory],
    inventoryChests: input.packs.reduce(
      (sum, pack) => sum + getPackChestTotal(pack),
      0,
    ),
    timerSeconds: input.activeRun?.elapsedSeconds ?? 0,
    packsDone: completedPacks,
    packsTotal: enabledPacks.length,
    dungeonsDone: completedDungeons.length,
    dungeonsTotal: totalDungeons,
    chests: completedDungeons.reduce(
      (sum, dungeon) => sum + dungeon.chests,
      0,
    ),
    farmTimeSeconds: completedDungeons.reduce(
      (sum, dungeon) => sum + dungeon.durationSeconds,
      0,
    ),
    server: input.profile.server || null,
    player: input.profile.name || null,
  };
}
