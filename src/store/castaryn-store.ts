import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import { desktopStorage } from "../lib/desktop-storage";
import { elapsedSecondsSince } from "../domain/time";
import {
  PERFECT_WORLD_TIME_ZONE,
  formatHistoryDate,
  formatWeekday,
  toGameDayKey,
} from "../domain/day";
import type {
  LootDungeonCategory,
  LootCalculationHistoryEntry,
  LootCalculatorSettings,
  LootItemPrice,
} from "../features/loot-calculator/types";
import { initialDungeons as lootCalculatorDungeons } from "../features/loot-calculator/data";
import {
  getDailyDungeonCategoryFromAnchor,
  getDungeonChestReward,
} from "../domain/daily-dungeon-cycle";

export type DungeonStatus = "idle" | "active" | "completed";

export interface Dungeon {
  id: string;
  name: string;
  category: string;
  status: DungeonStatus;
  durationSeconds: number;
  rewardedSlots: number;
  rewardedSlotIndexes: number[];
  chests: number;
  lootCategory: LootDungeonCategory;
  dailyCategory: LootDungeonCategory | null;
  chestsPerSlot: number;
}

export interface Pack {
  id: string;
  name: string;
  enabled: boolean;
  completedManually: boolean;
  /** Сундуки, происхождение которых известно. Ключ — стабильный id данжа. */
  chestInventoryByDungeon: Record<string, number[]>;
  dungeons: Dungeon[];
}

interface ActiveRun {
  packId: string;
  dungeonId: string;
  elapsedSeconds: number;
  startedAtMs?: number;
}

export type ArenaMode = "order" | "chaos";
export type ArenaResult = "win" | "loss";

function boundedInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export interface ArenaMatch {
  id: string;
  dayKey: string;
  playedAt: string;
  mode: ArenaMode;
  result: ArenaResult;
  ratingBefore: number;
  ratingDelta: number;
  ratingAfter: number;
}

export interface ImperialBattle {
  id: string;
  dayKey: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  placement: number | null;
}

interface ActiveImperialRun {
  dayKey: string;
  startedAtMs: number;
  elapsedSeconds: number;
}

export interface HistoryDay {
  dayKey: string;
  date: string;
  label: string;
  dungeons: number;
  chests: number;
  durationSeconds: number;
  packs: Array<{
    name: string;
    dungeons: Array<{
      id: string;
      name: string;
      durationSeconds: number;
      rewardedSlots: number;
      rewardedSlotIndexes: number[];
      chests: number;
      dailyCategory: LootDungeonCategory | null;
      chestsPerSlot: number;
    }>;
  }>;
}

export interface Profile {
  name: string;
  server: string;
}

export type PlayMode = "single" | "multi";

export interface InterfaceSettings {
  scale: 90 | 100 | 110;
  reduceMotion: boolean;
  compactMode: boolean;
  primaryShortcut: string;
  undoShortcut: string;
  startWithWindows: boolean;
}

interface RouteActionSnapshot {
  packs: Pack[];
  defaultPacks: Pack[];
  selectedPackId: string;
  activeRun: ActiveRun | null;
  dayKey: string;
  history: HistoryDay[];
  dailyCategoryOverride: CastarynState["dailyCategoryOverride"];
  nextRouteTarget: CastarynState["nextRouteTarget"];
}

interface CastarynState {
  hasHydrated: boolean;
  onboardingCompleted: boolean;
  playMode: PlayMode;
  gameTimeZone: string;
  dayKey: string;
  profile: Profile;
  defaultPacks: Pack[];
  packs: Pack[];
  selectedPackId: string;
  nextRouteTarget: { packId: string; dungeonId: string } | null;
  activeRun: ActiveRun | null;
  arenaRatings: Record<ArenaMode, number | null>;
  arenaMatches: ArenaMatch[];
  activeImperialRun: ActiveImperialRun | null;
  imperialBattles: ImperialBattle[];
  history: HistoryDay[];
  lootCalculator: LootCalculatorSettings;
  lootPrices: LootItemPrice[];
  lootHistory: LootCalculationHistoryEntry[];
  interfaceSettings: InterfaceSettings;
  dailyCategoryOverride: {
    dayKey: string;
    category: LootDungeonCategory;
  } | null;
  lastRouteAction: RouteActionSnapshot | null;
  routeActionLockedUntilMs: number;
  setHasHydrated: (value: boolean) => void;
  completeOnboarding: (input: {
    profile: Profile;
    playMode: PlayMode;
    packCount: number;
  }) => void;
  updateProfile: (profile: Profile) => void;
  setDefaultPackCount: (count: number) => void;
  renameDefaultPack: (packId: string, name: string) => void;
  toggleDefaultDungeon: (packId: string, dungeonId: string) => void;
  moveDefaultDungeon: (
    packId: string,
    dungeonId: string,
    direction: "up" | "down",
  ) => void;
  toggleTodayPack: (packId: string) => void;
  completePack: (packId: string) => void;
  updateDungeonReward: (
    packId: string,
    dungeonId: string,
    rewardedSlotIndexes: number[],
  ) => void;
  reopenDungeon: (packId: string, dungeonId: string) => void;
  resetTodayProgress: () => void;
  toggleTodayDungeon: (packId: string, dungeonId: string) => void;
  ensureCurrentDay: () => void;
  selectPack: (packId: string) => void;
  chooseNextRouteDungeon: (packId: string, dungeonId: string) => void;
  startRun: (packId: string, dungeonId: string) => void;
  tick: () => void;
  finishRun: () => void;
  cancelRun: () => void;
  setArenaRating: (mode: ArenaMode, rating: number) => void;
  recordArenaMatch: (
    mode: ArenaMode,
    result: ArenaResult,
    ratingChange: number,
  ) => void;
  amendLastArenaMatch: (
    mode: ArenaMode,
    result: ArenaResult,
    ratingChange: number,
  ) => void;
  deleteLastArenaMatch: (mode: ArenaMode) => void;
  startImperialBattle: () => void;
  finishImperialBattle: (placement?: number | null) => void;
  cancelImperialBattle: () => void;
  updateImperialPlacement: (id: string, placement: number | null) => void;
  deleteImperialBattle: (id: string) => void;
  updateLootCalculator: (settings: Partial<LootCalculatorSettings>) => void;
  toggleLootDungeon: (dungeonId: string) => void;
  updateLootPrice: (itemId: string, price: number) => void;
  resetLootPrice: (itemId: string) => void;
  saveLootCalculation: (
    entry: Omit<LootCalculationHistoryEntry, "id" | "createdAt">,
  ) => void;
  deleteLootCalculation: (id: string) => void;
  updateInterfaceSettings: (settings: Partial<InterfaceSettings>) => void;
  updatePackChestInventory: (
    packId: string,
    dungeonId: string,
    slotIndex: number,
    value: number,
  ) => void;
  setDailyCategoryOverride: (category: LootDungeonCategory | null) => void;
  routePrimaryAction: () => void;
  undoRouteAction: () => void;
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(64),
  server: z.string().trim().max(64),
});

export const dungeonCatalog = [
  ["eternity-caves-low", "Пещеры вечности (низкий уровень)", "Доспехи"],
  ["silver-citadel-normal", "Серебряная цитадель (простой)", "Доспехи"],
  ["silver-citadel-hard", "Серебряная цитадель (сложный)", "Доспехи"],
  ["twilight-library", "Сумеречная библиотека", "Доспехи"],
  ["celestial-palace", "Небесный дворец", "Доспехи"],
  ["dream-terrace-normal", "Терраса снов (простой)", "Доспехи"],
  ["dream-terrace-hard", "Терраса снов (сложный)", "Доспехи"],
  ["dream-terrace-legendary", "Терраса снов (легендарный)", "Доспехи"],
  ["eternity-caves-high", "Пещеры вечности (высокий уровень)", "Оружие"],
  ["full-moon-pavilion", "Павильон Полнолуния", "Оружие"],
  ["sea-of-illusions", "Море Иллюзий", "Оружие"],
  ["whispering-tomb", "Гробница шепотов", "Оружие"],
  ["elements-temple", "Храм стихий", "Реликвии"],
  ["frozen-hell", "Ледяной ад (10)", "Реликвии"],
  ["frozen-hell-15", "Ледяной ад (15)", "Реликвии"],
  ["frozen-hell-19", "Ледяной ад (19)", "Реликвии"],
  ["frozen-hell-21", "Ледяной ад (21)", "Реликвии"],
  ["frozen-hell-23", "Ледяной ад (23)", "Реликвии"],
  ["dawn-palace", "Дворец Рассвета", "Реликвии"],
  ["knights-island", "Остров Рыцарей", "Реликвии"],
] as const;

export type DungeonCategory = (typeof dungeonCatalog)[number][2];

export const dungeonCategories: DungeonCategory[] = [
  "Доспехи",
  "Оружие",
  "Реликвии",
];

export const featuredDungeonIds = [
  "whispering-tomb",
  "knights-island",
  "dream-terrace-legendary",
] as const;

export const trackerDungeonToLootDungeonId: Record<string, string> = {
  "eternity-caves-low": "1",
  "silver-citadel-normal": "2",
  "silver-citadel-hard": "3",
  "twilight-library": "4",
  "celestial-palace": "5",
  "dream-terrace-normal": "6",
  "dream-terrace-hard": "7",
  "dream-terrace-legendary": "8",
  "eternity-caves-high": "9",
  "full-moon-pavilion": "10",
  "sea-of-illusions": "11",
  "whispering-tomb": "12",
  "elements-temple": "13",
  "frozen-hell": "14",
  "frozen-hell-15": "15",
  "frozen-hell-19": "16",
  "frozen-hell-21": "17",
  "frozen-hell-23": "18",
  "dawn-palace": "19",
  "knights-island": "20",
};

export const lootDungeonToTrackerDungeonId = Object.fromEntries(
  Object.entries(trackerDungeonToLootDungeonId).map(([trackerId, lootId]) => [
    lootId,
    trackerId,
  ]),
) as Record<string, string>;

const lootDungeonById = new Map(
  lootCalculatorDungeons.map((dungeon) => [dungeon.id, dungeon]),
);
const dungeonLootCategoryById = new Map<string, LootDungeonCategory>(
  Object.entries(trackerDungeonToLootDungeonId).map(([trackerId, lootId]) => [
    trackerId,
    lootDungeonById.get(lootId)?.category ?? "relic",
  ]),
);

export function getPackDungeonChestTotal(pack: Pack, dungeonId: string) {
  return (pack.chestInventoryByDungeon[dungeonId] ?? []).reduce(
    (sum, value) => sum + value,
    0,
  );
}

export function getPackChestTotal(pack: Pack) {
  return Object.values(pack.chestInventoryByDungeon).reduce(
    (sum, slots) => sum + slots.reduce((slotSum, value) => slotSum + value, 0),
    0,
  );
}

const previousDungeonIds = new Set([
  "dawn-palace",
  "elements-temple",
  "frozen-hell",
  "knights-island",
]);

function createDungeons(
  completedCount: number,
  durations: number[],
  rewardAdjustments: number[] = [],
  dungeonIds: readonly string[] = featuredDungeonIds,
): Dungeon[] {
  return dungeonCatalog
    .filter(([id]) => dungeonIds.includes(id))
    .map(([id, name, category], index) => {
    const completed = index < completedCount;
    const rewardedSlots = completed ? rewardAdjustments[index] ?? (index === 0 ? 10 : 9) : 0;
    return {
      id,
      name,
      category,
      status: completed ? "completed" : "idle",
      durationSeconds: completed ? durations[index] ?? 0 : 0,
      rewardedSlots,
      rewardedSlotIndexes: Array.from({ length: rewardedSlots }, (_, slot) => slot),
      chests: rewardedSlots * 2,
      lootCategory: dungeonLootCategoryById.get(id) ?? "relic",
      dailyCategory: null,
      chestsPerSlot: 2,
    };
    });
}

function createCatalogDungeons(): Dungeon[] {
  return createDungeons(
    0,
    [],
    [],
    dungeonCatalog.map(([id]) => id),
  );
}

function moveDungeon(
  dungeons: Dungeon[],
  dungeonId: string,
  direction: "up" | "down",
) {
  const index = dungeons.findIndex((dungeon) => dungeon.id === dungeonId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= dungeons.length) {
    return dungeons;
  }
  const next = [...dungeons];
  [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
  return next;
}

function removeCompletedReward(
  pack: Pack,
  completedDungeon: Dungeon,
  maxSlots: number,
  resetDungeon: boolean,
): Pack {
  const previousIndexes =
    completedDungeon.rewardedSlotIndexes ??
    Array.from(
      { length: completedDungeon.rewardedSlots },
      (_, slot) => slot,
    );
  const reward = completedDungeon.chestsPerSlot || 2;
  const currentInventory =
    pack.chestInventoryByDungeon[completedDungeon.id] ??
    Array.from({ length: maxSlots }, () => 0);

  return {
    ...pack,
    completedManually: resetDungeon ? false : pack.completedManually,
    chestInventoryByDungeon: {
      ...pack.chestInventoryByDungeon,
      [completedDungeon.id]: currentInventory.map((value, index) =>
        Math.max(0, value - (previousIndexes.includes(index) ? reward : 0)),
      ),
    },
    dungeons: resetDungeon
      ? pack.dungeons.map((dungeon) =>
          dungeon.id === completedDungeon.id
            ? {
                ...dungeon,
                status: "idle",
                durationSeconds: 0,
                rewardedSlots: 0,
                rewardedSlotIndexes: [],
                chests: 0,
                dailyCategory: null,
                chestsPerSlot: 2,
              }
            : dungeon,
        )
      : pack.dungeons,
  };
}

function migratePackToExpandedCatalog(pack: Pack): Pack {
  const templates = createCatalogDungeons();
  const existingById = new Map(
    pack.dungeons.map((dungeon) => [dungeon.id, dungeon]),
  );
  const dungeons = templates.flatMap((template) => {
    const existing = existingById.get(template.id);
    if (existing) {
      return [{
        ...existing,
        name: template.name,
        category: template.category,
        lootCategory: template.lootCategory,
        dailyCategory: existing.dailyCategory ?? null,
        chestsPerSlot: existing.chestsPerSlot ?? 2,
      }];
    }
    return previousDungeonIds.has(template.id) ? [] : [template];
  });

  return {
    ...pack,
    dungeons: dungeons.length > 0 ? dungeons : pack.dungeons,
  };
}

function migratePackToFeaturedCatalog(pack: Pack): Pack {
  const ids = new Set(pack.dungeons.map((dungeon) => dungeon.id));
  const isExpandedDefault = ids.size === dungeonCatalog.length;
  const isLegacyDefault =
    ids.size > 0 && [...ids].every((id) => previousDungeonIds.has(id));

  if (!isExpandedDefault && !isLegacyDefault) return pack;

  const existingById = new Map(
    pack.dungeons.map((dungeon) => [dungeon.id, dungeon]),
  );
  const dungeons = createDungeons(0, []).map((template) => {
    const existing = existingById.get(template.id);
    return existing
      ? {
          ...existing,
          name: template.name,
          category: template.category,
          lootCategory: template.lootCategory,
          dailyCategory: existing.dailyCategory ?? null,
          chestsPerSlot: existing.chestsPerSlot ?? 2,
        }
      : template;
  });

  return { ...pack, dungeons };
}

export const useCastarynStore = create<CastarynState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      onboardingCompleted: false,
      playMode: "multi",
      gameTimeZone: PERFECT_WORLD_TIME_ZONE,
      dayKey: toGameDayKey(),
      profile: {
        name: "",
        server: "",
      },
      defaultPacks: [],
      packs: [],
      selectedPackId: "",
      nextRouteTarget: null,
      activeRun: null,
      arenaRatings: { order: null, chaos: null },
      arenaMatches: [],
      activeImperialRun: null,
      imperialBattles: [],
      history: [],
      lootCalculator: {
        characterCount: 10,
        doubleReward: false,
        selectedDungeonIds: ["8", "12", "20"],
        source: "forecast",
        selectedPackIds: [],
      },
      lootPrices: [],
      lootHistory: [],
      interfaceSettings: {
        scale: 100,
        reduceMotion: false,
        compactMode: false,
        primaryShortcut: "Shift+F1",
        undoShortcut: "Shift+G",
        startWithWindows: false,
      },
      dailyCategoryOverride: null,
      lastRouteAction: null,
      routeActionLockedUntilMs: 0,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      completeOnboarding: ({ profile, playMode, packCount }) => {
        const validated = profileSchema.safeParse(profile);
        if (!validated.success) return;

        const safePackCount =
          playMode === "single" ? 1 : Math.min(20, Math.max(1, Math.floor(packCount)));
        const packs = Array.from({ length: safePackCount }, (_, index) => ({
          id: `pack-${index + 1}`,
          name: playMode === "single" ? "Персонаж" : `Пачка ${index + 1}`,
          enabled: true,
          completedManually: false,
          chestInventoryByDungeon: {},
          dungeons: createDungeons(0, []),
        }));

        set({
          onboardingCompleted: true,
          playMode,
          gameTimeZone: PERFECT_WORLD_TIME_ZONE,
          dayKey: toGameDayKey(),
          profile: validated.data,
          defaultPacks: structuredClone(packs),
          packs: structuredClone(packs),
          selectedPackId: "",
          nextRouteTarget: null,
          activeRun: null,
          history: [],
        });
      },
      updateProfile: (profile) => {
        const validated = profileSchema.safeParse(profile);
        if (!validated.success) return;
        set({ profile: validated.data, lastRouteAction: null });
      },
      setDefaultPackCount: (count) => {
        if (get().activeRun || get().playMode === "single") return;
        const safeCount = Math.min(20, Math.max(1, Math.floor(count)));
        set((state) => {
          if (safeCount < state.defaultPacks.length) {
            const removedIds = new Set(
              state.defaultPacks.slice(safeCount).map((pack) => pack.id),
            );
            const hasProtectedData = [...state.defaultPacks, ...state.packs]
              .filter((pack) => removedIds.has(pack.id))
              .some(
                (pack) =>
                  getPackChestTotal(pack) > 0 ||
                  pack.completedManually ||
                  pack.dungeons.some((dungeon) => dungeon.status !== "idle"),
              );
            if (hasProtectedData) return state;
          }
          const nextDefault = Array.from({ length: safeCount }, (_, index) => {
            const existing = state.defaultPacks[index];
            return existing
              ? structuredClone(existing)
              : {
                  id: `pack-${index + 1}`,
                  name: `Пачка ${index + 1}`,
                  enabled: true,
                  completedManually: false,
                  chestInventoryByDungeon: {},
                  dungeons: createDungeons(0, []),
                };
          });
          const nextToday = nextDefault.map((template) => {
            const existing = state.packs.find((pack) => pack.id === template.id);
            return existing ?? structuredClone(template);
          });
          return {
            defaultPacks: nextDefault,
            packs: nextToday,
            selectedPackId: nextToday.some(
              (pack) => pack.id === state.selectedPackId,
            )
              ? state.selectedPackId
              : "",
            lastRouteAction: null,
          };
        });
      },
      renameDefaultPack: (packId, name) => {
        const safeName = name.trim().slice(0, 48);
        if (!safeName || get().activeRun) return;
        set((state) => ({
          defaultPacks: state.defaultPacks.map((pack) =>
            pack.id === packId ? { ...pack, name: safeName } : pack,
          ),
          packs: state.packs.map((pack) =>
            pack.id === packId ? { ...pack, name: safeName } : pack,
          ),
          lastRouteAction: null,
        }));
      },
      toggleDefaultDungeon: (packId, dungeonId) => {
        if (get().activeRun) return;
        set((state) => ({
          defaultPacks: state.defaultPacks.map((pack) => {
            if (pack.id !== packId) return pack;
            const existing = pack.dungeons.some(
              (dungeon) => dungeon.id === dungeonId,
            );
            if (existing && pack.dungeons.length === 1) return pack;
            if (existing) {
              return {
                ...pack,
                dungeons: pack.dungeons.filter(
                  (dungeon) => dungeon.id !== dungeonId,
                ),
              };
            }
            const template = createCatalogDungeons().find(
              (dungeon) => dungeon.id === dungeonId,
            );
            if (!template) return pack;
            return {
              ...pack,
              dungeons: [...pack.dungeons, template],
            };
          }),
          lastRouteAction: null,
        }));
      },
      moveDefaultDungeon: (packId, dungeonId, direction) => {
        if (get().activeRun) return;
        set((state) => ({
          defaultPacks: state.defaultPacks.map((pack) =>
            pack.id === packId
              ? {
                  ...pack,
                  dungeons: moveDungeon(
                    pack.dungeons,
                    dungeonId,
                    direction,
                  ),
                }
              : pack,
          ),
          packs: state.packs.map((pack) =>
            pack.id === packId
              ? {
                  ...pack,
                  dungeons: moveDungeon(
                    pack.dungeons,
                    dungeonId,
                    direction,
                  ),
                }
              : pack,
          ),
          lastRouteAction: null,
        }));
      },
      toggleTodayPack: (packId) => {
        if (get().activeRun) return;
        set((state) => ({
          packs: state.packs.map((pack) =>
            pack.id === packId &&
            !pack.dungeons.some((dungeon) => dungeon.status !== "idle")
              ? { ...pack, enabled: !pack.enabled }
              : pack,
          ),
          selectedPackId:
            state.selectedPackId === packId ? "" : state.selectedPackId,
          lastRouteAction: null,
        }));
      },
      completePack: (packId) => {
        if (get().activeRun) return;
        set((state) => ({
          packs: state.packs.map((pack) =>
            pack.id === packId && pack.enabled
              ? { ...pack, completedManually: true }
              : pack,
          ),
          selectedPackId:
            state.selectedPackId === packId ? "" : state.selectedPackId,
          lastRouteAction: null,
        }));
      },
      updateDungeonReward: (packId, dungeonId, rewardedSlotIndexes) => {
        const maxSlots = get().playMode === "single" ? 1 : 10;
        const safeIndexes = [
          ...new Set(
            rewardedSlotIndexes
              .map((slot) => Math.floor(slot))
              .filter((slot) => slot >= 0 && slot < maxSlots),
          ),
        ].sort((left, right) => left - right);
        set((state) => {
          const pack = state.packs.find((item) => item.id === packId);
          const dungeon = pack?.dungeons.find((item) => item.id === dungeonId);
          if (!pack || !dungeon || dungeon.status !== "completed") return state;
          const previousIndexes =
            dungeon.rewardedSlotIndexes ??
            Array.from({ length: dungeon.rewardedSlots }, (_, slot) => slot);
          const reward = dungeon.chestsPerSlot || 2;
          const updatePack = (item: Pack, updateDungeon: boolean): Pack =>
            item.id !== packId
              ? item
              : {
                  ...item,
                  chestInventoryByDungeon: {
                    ...item.chestInventoryByDungeon,
                    [dungeonId]: (
                      item.chestInventoryByDungeon[dungeonId] ??
                      Array.from({ length: maxSlots }, () => 0)
                    ).map((value, index) => {
                    const wasRewarded = previousIndexes.includes(index);
                    const isRewarded = safeIndexes.includes(index);
                    if (wasRewarded === isRewarded) return value;
                    return Math.max(0, value + (isRewarded ? reward : -reward));
                  }),
                  },
                  dungeons: updateDungeon ? item.dungeons.map((entry) =>
                    entry.id === dungeonId
                      ? {
                          ...entry,
                          rewardedSlots: safeIndexes.length,
                          rewardedSlotIndexes: safeIndexes,
                          chests: safeIndexes.length * reward,
                        }
                      : entry,
                  ) : item.dungeons,
                };
          return {
            packs: state.packs.map((item) => updatePack(item, true)),
            defaultPacks: state.defaultPacks.map((item) =>
              updatePack(item, false),
            ),
            lastRouteAction: null,
          };
        });
      },
      reopenDungeon: (packId, dungeonId) => {
        if (get().activeRun) return;
        set((state) => {
          const completedDungeon = state.packs
            .find((pack) => pack.id === packId)
            ?.dungeons.find(
              (dungeon) =>
                dungeon.id === dungeonId &&
                dungeon.status === "completed",
            );
          if (!completedDungeon) return state;
          const maxSlots = state.playMode === "single" ? 1 : 10;
          return {
            packs: state.packs.map((pack) =>
              pack.id === packId
                ? removeCompletedReward(
                    pack,
                    completedDungeon,
                    maxSlots,
                    true,
                  )
                : pack,
            ),
            defaultPacks: state.defaultPacks.map((pack) =>
              pack.id === packId
                ? removeCompletedReward(
                    pack,
                    completedDungeon,
                    maxSlots,
                    false,
                  )
                : pack,
            ),
            lastRouteAction: null,
          };
        });
      },
      resetTodayProgress: () => {
        if (get().activeRun) return;
        set((state) => {
          const maxSlots = state.playMode === "single" ? 1 : 10;
          const completedByPack = new Map(
            state.packs.map((pack) => [
              pack.id,
              pack.dungeons.filter(
                (dungeon) => dungeon.status === "completed",
              ),
            ]),
          );
          const resetPack = (pack: Pack, resetDungeons: boolean) =>
            (completedByPack.get(pack.id) ?? []).reduce(
              (current, dungeon) =>
                removeCompletedReward(
                  current,
                  dungeon,
                  maxSlots,
                  resetDungeons,
                ),
              resetDungeons
                ? { ...pack, completedManually: false }
                : pack,
            );
          return {
            packs: state.packs.map((pack) => resetPack(pack, true)),
            defaultPacks: state.defaultPacks.map((pack) =>
              resetPack(pack, false),
            ),
            selectedPackId: "",
            lastRouteAction: null,
          };
        });
      },
      toggleTodayDungeon: (packId, dungeonId) => {
        if (get().activeRun) return;
        set((state) => ({
          packs: state.packs.map((pack) => {
            if (pack.id !== packId) return pack;
            const existing = pack.dungeons.find((dungeon) => dungeon.id === dungeonId);
            if (existing) {
              if (existing.status !== "idle") return pack;
              return {
                ...pack,
                dungeons: pack.dungeons.filter((dungeon) => dungeon.id !== dungeonId),
              };
            }

            const template = state.defaultPacks
              .find((item) => item.id === packId)
              ?.dungeons.find((dungeon) => dungeon.id === dungeonId) ??
              createCatalogDungeons().find(
                (dungeon) => dungeon.id === dungeonId,
              );
            if (!template) return pack;

            return {
              ...pack,
              dungeons: [...pack.dungeons, structuredClone(template)],
            };
          }),
          lastRouteAction: null,
        }));
      },
      ensureCurrentDay: () => {
        const state = get();
        const currentDayKey = toGameDayKey(
          new Date(),
          state.gameTimeZone || PERFECT_WORLD_TIME_ZONE,
        );
        if (
          state.dayKey === currentDayKey ||
          state.activeRun ||
          state.activeImperialRun
        )
          return;

        const completed = state.packs.flatMap((pack) =>
          pack.dungeons
            .filter((dungeon) => dungeon.status === "completed")
            .map((dungeon) => ({ packName: pack.name, dungeon })),
        );

        const archived: HistoryDay | null =
          completed.length === 0
            ? null
            : {
                dayKey: state.dayKey,
                date: formatHistoryDate(state.dayKey),
                label: formatWeekday(state.dayKey),
                dungeons: completed.length,
                chests: completed.reduce((sum, item) => sum + item.dungeon.chests, 0),
                durationSeconds: completed.reduce(
                  (sum, item) => sum + item.dungeon.durationSeconds,
                  0,
                ),
                packs: state.packs
                  .map((pack) => ({
                    name: pack.name,
                    dungeons: pack.dungeons
                      .filter((dungeon) => dungeon.status === "completed")
                      .map((dungeon) => ({
                        id: dungeon.id,
                        name: dungeon.name,
                        durationSeconds: dungeon.durationSeconds,
                        rewardedSlots: dungeon.rewardedSlots,
                        rewardedSlotIndexes:
                          dungeon.rewardedSlotIndexes ??
                          Array.from(
                            { length: dungeon.rewardedSlots },
                            (_, slot) => slot,
                          ),
                        chests: dungeon.chests,
                        dailyCategory: dungeon.dailyCategory,
                        chestsPerSlot: dungeon.chestsPerSlot,
                      })),
                  }))
                  .filter((pack) => pack.dungeons.length > 0),
              };

        const packs = structuredClone(state.defaultPacks);
        set({
          dayKey: currentDayKey,
          packs,
          selectedPackId: "",
          nextRouteTarget: null,
          history: archived ? [archived, ...state.history] : state.history,
          lastRouteAction: null,
        });
      },
      selectPack: (packId) => {
        if (
          !get().packs.some(
            (pack) =>
              pack.id === packId &&
              pack.enabled &&
              !pack.completedManually,
          )
        )
          return;
        set({
          selectedPackId: packId,
          nextRouteTarget: null,
          lastRouteAction: null,
        });
      },
      chooseNextRouteDungeon: (packId, dungeonId) => {
        const pack = get().packs.find(
          (item) =>
            item.id === packId && item.enabled && !item.completedManually,
        );
        if (
          !pack?.dungeons.some(
            (dungeon) => dungeon.id === dungeonId && dungeon.status === "idle",
          )
        )
          return;
        set({
          selectedPackId: packId,
          nextRouteTarget: { packId, dungeonId },
          lastRouteAction: null,
        });
      },
      startRun: (packId, dungeonId) => {
        const now = Date.now();
        if (
          get().activeRun ||
          get().activeImperialRun ||
          now < get().routeActionLockedUntilMs
        )
          return;
        const target = get()
          .packs.find((pack) => pack.id === packId)
          ?.dungeons.find((dungeon) => dungeon.id === dungeonId);
        const targetPack = get().packs.find((pack) => pack.id === packId);
        if (
          !target ||
          target.status !== "idle" ||
          !targetPack?.enabled ||
          targetPack.completedManually
        )
          return;

        set((state) => ({
          routeActionLockedUntilMs: now + 700,
          selectedPackId: packId,
          nextRouteTarget: null,
          activeRun: {
            packId,
            dungeonId,
            elapsedSeconds: 0,
            startedAtMs: Date.now(),
          },
          packs: state.packs.map((pack) =>
            pack.id !== packId
              ? pack
              : {
                  ...pack,
                  dungeons: pack.dungeons.map((dungeon) =>
                    dungeon.id === dungeonId
                      ? { ...dungeon, status: "active" }
                      : dungeon,
                  ),
                },
          ),
          lastRouteAction: null,
        }));
      },
      tick: () => {
        set((state) => {
          if (!state.activeRun && !state.activeImperialRun) return state;
          const startedAtMs = state.activeRun
            ? (state.activeRun.startedAtMs ??
              Date.now() - state.activeRun.elapsedSeconds * 1000)
            : null;
          return {
            activeRun:
              state.activeRun && startedAtMs
                ? {
                    ...state.activeRun,
                    startedAtMs,
                    elapsedSeconds: elapsedSecondsSince(startedAtMs),
                  }
                : null,
            activeImperialRun: state.activeImperialRun
              ? {
                  ...state.activeImperialRun,
                  elapsedSeconds: elapsedSecondsSince(
                    state.activeImperialRun.startedAtMs,
                  ),
                }
              : null,
          };
        });
      },
      finishRun: () => {
        const now = Date.now();
        if (now < get().routeActionLockedUntilMs) return;
        const run = get().activeRun;
        if (!run) return;
        const rewardedSlots = get().playMode === "single" ? 1 : 10;
        const rewardedSlotIndexes = Array.from(
          { length: rewardedSlots },
          (_, slot) => slot,
        );
        const stateBeforeFinish = get();
        const targetDungeon = stateBeforeFinish.packs
          .find((pack) => pack.id === run.packId)
          ?.dungeons.find((dungeon) => dungeon.id === run.dungeonId);
        if (!targetDungeon) return;
        const dailyCategory = getDailyDungeonCategoryFromAnchor(
          stateBeforeFinish.dayKey,
          stateBeforeFinish.dailyCategoryOverride,
        );
        const chestsPerSlot = getDungeonChestReward(
          targetDungeon.lootCategory,
          dailyCategory,
        );
        const finalElapsedSeconds = run.startedAtMs
          ? elapsedSecondsSince(run.startedAtMs)
          : run.elapsedSeconds;
        set((state) => ({
          routeActionLockedUntilMs: now + 700,
          activeRun: null,
          defaultPacks: state.defaultPacks.map((pack) =>
            pack.id !== run.packId
              ? pack
              : {
                  ...pack,
                  chestInventoryByDungeon: {
                    ...pack.chestInventoryByDungeon,
                    [run.dungeonId]: (
                      pack.chestInventoryByDungeon[run.dungeonId] ??
                      Array.from({ length: rewardedSlots }, () => 0)
                    ).map((value, index) => value + (rewardedSlotIndexes.includes(index) ? chestsPerSlot : 0)),
                  },
                },
          ),
          packs: state.packs.map((pack) =>
            pack.id !== run.packId
              ? pack
              : {
                  ...pack,
                  chestInventoryByDungeon: {
                    ...pack.chestInventoryByDungeon,
                    [run.dungeonId]: (
                      pack.chestInventoryByDungeon[run.dungeonId] ??
                      Array.from({ length: rewardedSlots }, () => 0)
                    ).map((value, index) => value + (rewardedSlotIndexes.includes(index) ? chestsPerSlot : 0)),
                  },
                  dungeons: pack.dungeons.map((dungeon) =>
                    dungeon.id === run.dungeonId
                      ? {
                          ...dungeon,
                          status: "completed",
                          durationSeconds: Math.max(1, finalElapsedSeconds),
                          rewardedSlots,
                          rewardedSlotIndexes,
                          chests: rewardedSlots * chestsPerSlot,
                          dailyCategory,
                          chestsPerSlot,
                        }
                      : dungeon,
                  ),
                },
          ),
          lastRouteAction: null,
        }));
        get().ensureCurrentDay();
      },
      cancelRun: () => {
        const run = get().activeRun;
        if (!run) return;
        set((state) => ({
          activeRun: null,
          packs: state.packs.map((pack) =>
            pack.id !== run.packId
              ? pack
              : {
                  ...pack,
                  dungeons: pack.dungeons.map((dungeon) =>
                    dungeon.id === run.dungeonId
                      ? { ...dungeon, status: "idle" }
                      : dungeon,
                  ),
                },
          ),
          lastRouteAction: null,
        }));
        get().ensureCurrentDay();
      },
      setArenaRating: (mode, rating) =>
        set((state) => ({
          arenaRatings: {
            ...state.arenaRatings,
            [mode]: boundedInteger(rating, 0, 99_999),
          },
        })),
      recordArenaMatch: (mode, result, ratingChange) =>
        set((state) => {
          const ratingBefore = state.arenaRatings[mode];
          if (ratingBefore === null) return state;
          const amount = boundedInteger(Math.abs(ratingChange), 0, 999);
          const ratingDelta = result === "win" ? amount : -amount;
          const ratingAfter = Math.min(
            99_999,
            Math.max(0, ratingBefore + ratingDelta),
          );
          return {
            arenaRatings: { ...state.arenaRatings, [mode]: ratingAfter },
            arenaMatches: [
              {
                id: crypto.randomUUID(),
                dayKey: toGameDayKey(),
                playedAt: new Date().toISOString(),
                mode,
                result,
                ratingBefore,
                ratingDelta: ratingAfter - ratingBefore,
                ratingAfter,
              },
              ...state.arenaMatches,
            ].slice(0, 2_000),
          };
        }),
      amendLastArenaMatch: (mode, result, ratingChange) =>
        set((state) => {
          const latest = state.arenaMatches.find((match) => match.mode === mode);
          if (!latest) return state;
          const amount = boundedInteger(Math.abs(ratingChange), 0, 999);
          const desiredDelta = result === "win" ? amount : -amount;
          const ratingAfter = Math.min(
            99_999,
            Math.max(0, latest.ratingBefore + desiredDelta),
          );
          return {
            arenaRatings: { ...state.arenaRatings, [mode]: ratingAfter },
            arenaMatches: state.arenaMatches.map((match) =>
              match.id === latest.id
                ? {
                    ...match,
                    result,
                    ratingDelta: ratingAfter - latest.ratingBefore,
                    ratingAfter,
                  }
                : match,
            ),
          };
        }),
      deleteLastArenaMatch: (mode) =>
        set((state) => {
          const latest = state.arenaMatches.find((match) => match.mode === mode);
          if (!latest) return state;
          return {
            arenaRatings: {
              ...state.arenaRatings,
              [mode]: latest.ratingBefore,
            },
            arenaMatches: state.arenaMatches.filter(
              (match) => match.id !== latest.id,
            ),
          };
        }),
      startImperialBattle: () => {
        if (get().activeRun || get().activeImperialRun) return;
        const startedAtMs = Date.now();
        set({
          activeImperialRun: {
            dayKey: toGameDayKey(),
            startedAtMs,
            elapsedSeconds: 0,
          },
        });
      },
      finishImperialBattle: (placement) => {
        const active = get().activeImperialRun;
        if (!active) return;
        const safePlacement =
          placement === null || placement === undefined
            ? null
            : boundedInteger(placement, 1, 99);
        const endedAt = new Date();
        set((state) => ({
          activeImperialRun: null,
          imperialBattles: [
            {
              id: crypto.randomUUID(),
              dayKey: active.dayKey,
              startedAt: new Date(active.startedAtMs).toISOString(),
              endedAt: endedAt.toISOString(),
              durationSeconds: Math.max(
                1,
                elapsedSecondsSince(active.startedAtMs),
              ),
              placement: safePlacement,
            },
            ...state.imperialBattles,
          ].slice(0, 2_000),
        }));
        get().ensureCurrentDay();
      },
      cancelImperialBattle: () => {
        if (!get().activeImperialRun) return;
        set({ activeImperialRun: null });
        get().ensureCurrentDay();
      },
      updateImperialPlacement: (id, placement) =>
        set((state) => ({
          imperialBattles: state.imperialBattles.map((battle) =>
            battle.id === id
              ? {
                  ...battle,
                  placement:
                    placement === null
                      ? null
                      : boundedInteger(placement, 1, 99),
                }
              : battle,
          ),
        })),
      deleteImperialBattle: (id) =>
        set((state) => ({
          imperialBattles: state.imperialBattles.filter(
            (battle) => battle.id !== id,
          ),
        })),
      updateLootCalculator: (settings) =>
        set((state) => ({
          lootCalculator: {
            ...state.lootCalculator,
            ...settings,
            source: settings.source ?? state.lootCalculator.source,
            selectedPackIds:
              settings.selectedPackIds ??
              state.lootCalculator.selectedPackIds,
            characterCount:
              settings.characterCount === undefined
                ? state.lootCalculator.characterCount
                : Math.min(
                    1000,
                    Math.max(1, Math.floor(settings.characterCount)),
                  ),
          },
        })),
      toggleLootDungeon: (dungeonId) =>
        set((state) => {
          const selected = state.lootCalculator.selectedDungeonIds.includes(
            dungeonId,
          );
          if (selected && state.lootCalculator.selectedDungeonIds.length === 1) {
            return state;
          }
          return {
            lootCalculator: {
              ...state.lootCalculator,
              selectedDungeonIds: selected
                ? state.lootCalculator.selectedDungeonIds.filter(
                    (id) => id !== dungeonId,
                  )
                : [...state.lootCalculator.selectedDungeonIds, dungeonId],
            },
          };
        }),
      updateLootPrice: (itemId, price) =>
        set((state) => {
          const safePrice = Math.max(0, Math.floor(price));
          return {
            lootPrices: [
              ...state.lootPrices.filter((item) => item.itemId !== itemId),
              { itemId, price: safePrice },
            ],
          };
        }),
      resetLootPrice: (itemId) =>
        set((state) => ({
          lootPrices: state.lootPrices.filter((item) => item.itemId !== itemId),
        })),
      saveLootCalculation: (entry) =>
        set((state) => ({
          lootHistory: [
            {
              ...entry,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
            ...state.lootHistory,
          ].slice(0, 200),
        })),
      deleteLootCalculation: (id) =>
        set((state) => ({
          lootHistory: state.lootHistory.filter((entry) => entry.id !== id),
        })),
      updateInterfaceSettings: (settings) =>
        set((state) => ({
          interfaceSettings: {
            ...state.interfaceSettings,
            ...settings,
          },
        })),
      updatePackChestInventory: (packId, dungeonId, slotIndex, value) =>
        set((state) => ({
          packs: state.packs.map((pack) =>
            pack.id !== packId
              ? pack
              : {
                  ...pack,
                  chestInventoryByDungeon: {
                    ...pack.chestInventoryByDungeon,
                    [dungeonId]: (
                      pack.chestInventoryByDungeon[dungeonId] ??
                      Array.from(
                        { length: state.playMode === "single" ? 1 : 10 },
                        () => 0,
                      )
                    ).map((current, index) =>
                      index === slotIndex
                        ? Math.min(999_999, Math.max(0, Math.floor(value)))
                        : current,
                    ),
                  },
                },
          ),
          defaultPacks: state.defaultPacks.map((pack) =>
            pack.id !== packId
              ? pack
              : {
                  ...pack,
                  chestInventoryByDungeon: {
                    ...pack.chestInventoryByDungeon,
                    [dungeonId]: (
                      pack.chestInventoryByDungeon[dungeonId] ??
                      Array.from(
                        { length: state.playMode === "single" ? 1 : 10 },
                        () => 0,
                      )
                    ).map((current, index) =>
                      index === slotIndex
                        ? Math.min(999_999, Math.max(0, Math.floor(value)))
                        : current,
                    ),
                  },
                },
          ),
          lastRouteAction: null,
        })),
      setDailyCategoryOverride: (category) =>
        get().activeRun
          ? undefined
          :
        set((state) => ({
          dailyCategoryOverride: category
            ? { dayKey: state.dayKey, category }
            : null,
          lastRouteAction: null,
        })),
      routePrimaryAction: () => {
        const before = get();
        const now = Date.now();
        if (now < before.routeActionLockedUntilMs) return;
        if (before.activeImperialRun) {
          get().finishImperialBattle(null);
          return;
        }
        const snapshot: RouteActionSnapshot = {
          packs: structuredClone(before.packs),
          defaultPacks: structuredClone(before.defaultPacks),
          selectedPackId: before.selectedPackId,
          activeRun: before.activeRun
            ? { ...before.activeRun }
            : null,
          dayKey: before.dayKey,
          history: structuredClone(before.history),
          dailyCategoryOverride: before.dailyCategoryOverride
            ? { ...before.dailyCategoryOverride }
            : null,
          nextRouteTarget: before.nextRouteTarget
            ? { ...before.nextRouteTarget }
            : null,
        };

        if (before.activeRun) {
          get().finishRun();
          const after = get();
          const currentPackIndex = after.packs.findIndex(
            (pack) => pack.id === before.activeRun?.packId,
          );
          const currentPack = after.packs[currentPackIndex];
          const nextInPack = after.nextRouteTarget
            ? currentPack?.dungeons.find(
                (dungeon) =>
                  dungeon.id === after.nextRouteTarget?.dungeonId &&
                  after.nextRouteTarget.packId === currentPack.id &&
                  dungeon.status === "idle",
              )
            : currentPack?.dungeons.find(
                (dungeon) => dungeon.status === "idle",
              );
          if (nextInPack && currentPack) {
            set({
              selectedPackId: currentPack.id,
              nextRouteTarget: {
                packId: currentPack.id,
                dungeonId: nextInPack.id,
              },
              lastRouteAction: snapshot,
            });
            return;
          }
          const nextPack = after.packs
            .slice(currentPackIndex + 1)
            .find(
              (pack) =>
                pack.enabled &&
                !pack.completedManually &&
                pack.dungeons.some((dungeon) => dungeon.status === "idle"),
            );
          set({
            selectedPackId: nextPack?.id ?? "",
            nextRouteTarget: null,
            lastRouteAction: snapshot,
          });
          return;
        }

        const preferredPack = before.nextRouteTarget
          ? before.packs.find(
              (pack) =>
                pack.id === before.nextRouteTarget?.packId &&
                pack.enabled &&
                !pack.completedManually &&
                pack.dungeons.some(
                  (dungeon) =>
                    dungeon.id === before.nextRouteTarget?.dungeonId &&
                    dungeon.status === "idle",
                ),
            )
          : undefined;
        const selectedPack = before.packs.find(
          (pack) =>
            pack.id === before.selectedPackId &&
            pack.enabled &&
            !pack.completedManually,
        );
        const targetPack =
          preferredPack ??
          (selectedPack?.dungeons.some((dungeon) => dungeon.status === "idle")
            ? selectedPack
            : before.packs.find(
                (pack) =>
                  pack.enabled &&
                  !pack.completedManually &&
                  pack.dungeons.some((dungeon) => dungeon.status === "idle"),
              ));
        const targetDungeon = before.nextRouteTarget
          ? targetPack?.dungeons.find(
              (dungeon) =>
                dungeon.id === before.nextRouteTarget?.dungeonId &&
                dungeon.status === "idle",
            )
          : targetPack?.dungeons.find((dungeon) => dungeon.status === "idle");
        if (!targetPack || !targetDungeon) return;
        get().startRun(targetPack.id, targetDungeon.id);
        set({ lastRouteAction: snapshot });
      },
      undoRouteAction: () => {
        const snapshot = get().lastRouteAction;
        if (!snapshot) return;
        set({
          packs: structuredClone(snapshot.packs),
          defaultPacks: structuredClone(snapshot.defaultPacks),
          selectedPackId: snapshot.selectedPackId,
          activeRun: snapshot.activeRun
            ? { ...snapshot.activeRun }
            : null,
          dayKey: snapshot.dayKey,
          history: structuredClone(snapshot.history),
          dailyCategoryOverride: snapshot.dailyCategoryOverride
            ? { ...snapshot.dailyCategoryOverride }
            : null,
          nextRouteTarget: snapshot.nextRouteTarget
            ? { ...snapshot.nextRouteTarget }
            : null,
          lastRouteAction: null,
        });
      },
    }),
    {
      name: "castaryn-local-profile-v1",
      version: 16,
      storage: createJSONStorage(() => desktopStorage),
      migrate: (persistedState, version) => {
        let state = persistedState as Partial<CastarynState>;
        if (version < 2) {
          state = {
            ...state,
            onboardingCompleted: true,
            playMode: "multi",
            defaultPacks: structuredClone(state.packs ?? []),
          };
        }
        if (version < 3) {
          state = {
            ...state,
            defaultPacks: structuredClone(state.packs ?? []),
          };
        }
        if (version < 4) {
          state = {
            ...state,
            dayKey: toGameDayKey(),
          };
        }
        if (version < 5) {
          const normalizePack = (pack: Pack) => ({
            ...pack,
            enabled: pack.enabled ?? true,
            completedManually: pack.completedManually ?? false,
          });
          const normalizeHistory = (day: HistoryDay): HistoryDay => ({
            ...day,
            packs: day.packs.map((pack) => ({
              ...pack,
              dungeons: pack.dungeons.map((dungeon) =>
                typeof dungeon === "string"
                  ? {
                      id: dungeon,
                      name: dungeon,
                      durationSeconds: 0,
                      rewardedSlots: 0,
                      rewardedSlotIndexes: [],
                      chests: 0,
                      dailyCategory: null,
                      chestsPerSlot: 2,
                    }
                  : dungeon,
              ),
            })),
          });
          state = {
            ...state,
            selectedPackId: "",
            defaultPacks: (state.defaultPacks ?? []).map(normalizePack),
            packs: (state.packs ?? []).map(normalizePack),
            history: (state.history ?? []).map(normalizeHistory),
          };
        }
        if (version < 6) {
          state = {
            ...state,
            gameTimeZone: PERFECT_WORLD_TIME_ZONE,
            history: (state.history ?? []).map((day) => ({
              ...day,
              dayKey: day.dayKey ?? day.date.split(".").reverse().join("-"),
            })),
          };
        }
        if (version < 7) {
          state = {
            ...state,
            defaultPacks: (state.defaultPacks ?? []).map(
              migratePackToExpandedCatalog,
            ),
            packs: (state.packs ?? []).map((pack) =>
              pack.dungeons.every((dungeon) => dungeon.status === "idle")
                ? migratePackToExpandedCatalog(pack)
                : pack,
            ),
          };
        }
        if (version < 8) {
          state = {
            ...state,
            defaultPacks: (state.defaultPacks ?? []).map(
              migratePackToFeaturedCatalog,
            ),
            packs: (state.packs ?? []).map((pack) =>
              pack.dungeons.every((dungeon) => dungeon.status === "idle")
                ? migratePackToFeaturedCatalog(pack)
                : pack,
            ),
          };
        }
        if (version < 9) {
          state = {
            ...state,
            lootCalculator: state.lootCalculator ?? {
              characterCount: 10,
              doubleReward: false,
              selectedDungeonIds: ["8", "12", "20"],
              source: "forecast",
              selectedPackIds: [],
            },
            lootPrices: state.lootPrices ?? [],
            lootHistory: state.lootHistory ?? [],
          };
        }
        if (version < 10) {
          state = {
            ...state,
            interfaceSettings: state.interfaceSettings ?? {
              scale: 100,
              reduceMotion: false,
              compactMode: false,
              primaryShortcut: "Shift+F",
              undoShortcut: "Shift+G",
              startWithWindows: false,
            },
          };
        }
        if (version < 11) {
          const normalizePack = (pack: Pack): Pack => ({
            ...pack,
            chestInventoryByDungeon: {},
            dungeons: pack.dungeons.map((dungeon) => ({
              ...dungeon,
              rewardedSlotIndexes:
                dungeon.rewardedSlotIndexes ??
                Array.from(
                  { length: dungeon.rewardedSlots ?? 0 },
                  (_, slot) => slot,
                ),
              lootCategory:
                dungeon.lootCategory ??
                dungeonLootCategoryById.get(dungeon.id) ??
                "relic",
              dailyCategory: dungeon.dailyCategory ?? null,
              chestsPerSlot: dungeon.chestsPerSlot ?? 2,
            })),
          });
          state = {
            ...state,
            defaultPacks: (state.defaultPacks ?? []).map(normalizePack),
            packs: (state.packs ?? []).map(normalizePack),
            dailyCategoryOverride: null,
            interfaceSettings: {
              scale: state.interfaceSettings?.scale ?? 100,
              reduceMotion:
                state.interfaceSettings?.reduceMotion ?? false,
              compactMode:
                state.interfaceSettings?.compactMode ?? false,
              primaryShortcut: "Shift+F",
              undoShortcut: "Shift+G",
              startWithWindows: false,
            },
          };
        }
        if (version < 12) {
          state = {
            ...state,
            lootCalculator: {
              characterCount: state.lootCalculator?.characterCount ?? 10,
              doubleReward: state.lootCalculator?.doubleReward ?? false,
              selectedDungeonIds:
                state.lootCalculator?.selectedDungeonIds ?? ["8", "12", "20"],
              source: "forecast",
              selectedPackIds: [],
            },
          };
        }
        if (version < 13) {
          const normalizePack = (
            pack: Pack & { chestInventory?: number[] },
          ): Pack => ({
            ...pack,
            chestInventoryByDungeon: pack.chestInventoryByDungeon ?? {},
            dungeons: pack.dungeons.map((dungeon) => ({
              ...dungeon,
              rewardedSlotIndexes:
                dungeon.rewardedSlotIndexes ??
                Array.from(
                  { length: dungeon.rewardedSlots ?? 0 },
                  (_, slot) => slot,
                ),
            })),
          });
          state = {
            ...state,
            defaultPacks: (state.defaultPacks ?? []).map(normalizePack),
            packs: (state.packs ?? []).map(normalizePack),
            history: (state.history ?? []).map((day) => ({
              ...day,
              packs: day.packs.map((pack) => ({
                ...pack,
                dungeons: pack.dungeons.map((dungeon) => ({
                  ...dungeon,
                  rewardedSlotIndexes:
                    dungeon.rewardedSlotIndexes ??
                    Array.from(
                      { length: dungeon.rewardedSlots ?? 0 },
                      (_, slot) => slot,
                    ),
                })),
              })),
            })),
          };
        }
        if (version < 14) {
          const slotCount = state.playMode === "single" ? 1 : 10;
          type LegacyPack = Pack & {
            chestInventory?: number[];
            unassignedChestInventory?: number[];
          };
          const normalizePack = (pack: LegacyPack): Pack => {
            const {
              chestInventory: _legacyInventory,
              unassignedChestInventory: _legacyUnassigned,
              ...clean
            } = pack;
            return {
              ...clean,
              chestInventoryByDungeon: Object.fromEntries(
                Object.entries(pack.chestInventoryByDungeon ?? {}).map(
                  ([dungeonId, slots]) => [
                    dungeonId,
                    Array.from({ length: slotCount }, (_, index) =>
                      Math.min(
                        999_999,
                        Math.max(0, Math.floor(slots[index] ?? 0)),
                      ),
                    ),
                  ],
                ),
              ),
            };
          };
          state = {
            ...state,
            defaultPacks: (state.defaultPacks ?? []).map(normalizePack),
            packs: (state.packs ?? []).map(normalizePack),
          };
        }
        if (version < 15) {
          state = {
            ...state,
            interfaceSettings: {
              ...(state.interfaceSettings ?? {
                scale: 100,
                reduceMotion: false,
                compactMode: false,
                undoShortcut: "Shift+G",
                startWithWindows: false,
              }),
              primaryShortcut:
                !state.interfaceSettings ||
                state.interfaceSettings.primaryShortcut === "Shift+F"
                  ? "Shift+F1"
                  : state.interfaceSettings.primaryShortcut,
            },
          };
        }
        if (version < 16) {
          state = {
            ...state,
            arenaRatings: state.arenaRatings ?? {
              order: null,
              chaos: null,
            },
            arenaMatches: state.arenaMatches ?? [],
            activeImperialRun: null,
            imperialBattles: state.imperialBattles ?? [],
          };
        }
        return state as CastarynState;
      },
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        playMode: state.playMode,
        gameTimeZone: state.gameTimeZone,
        dayKey: state.dayKey,
        profile: state.profile,
        defaultPacks: state.defaultPacks,
        packs: state.packs,
        selectedPackId: state.selectedPackId,
        activeRun: state.activeRun
          ? { ...state.activeRun, elapsedSeconds: 0 }
          : null,
        arenaRatings: state.arenaRatings,
        arenaMatches: state.arenaMatches,
        activeImperialRun: state.activeImperialRun
          ? { ...state.activeImperialRun, elapsedSeconds: 0 }
          : null,
        imperialBattles: state.imperialBattles,
        history: state.history,
        lootCalculator: state.lootCalculator,
        lootPrices: state.lootPrices,
        lootHistory: state.lootHistory,
        interfaceSettings: state.interfaceSettings,
        dailyCategoryOverride: state.dailyCategoryOverride,
      }),
    },
  ),
);
