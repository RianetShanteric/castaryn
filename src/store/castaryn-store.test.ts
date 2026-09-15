import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dungeonCategories,
  dungeonCatalog,
  useCastarynStore,
} from "./castaryn-store";

function resetStore() {
  useCastarynStore.setState({
    hasHydrated: true,
    onboardingCompleted: false,
    playMode: "multi",
    gameTimeZone: "Europe/Moscow",
    dayKey: "2026-07-24",
    profile: { name: "", server: "" },
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
  });
}

describe("Castaryn Player store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ships the complete categorized Perfect World PvE catalog", () => {
    expect(dungeonCatalog).toHaveLength(20);
    expect(new Set(dungeonCatalog.map(([, , category]) => category))).toEqual(
      new Set(dungeonCategories),
    );
    expect(dungeonCatalog.map(([id]) => id)).toContain("dawn-palace");
    expect(dungeonCatalog.map(([id]) => id)).toContain("knights-island");
  });

  it("keeps calculator prices and calculation history local", () => {
    const store = useCastarynStore.getState();
    expect(store.lootCalculator.selectedDungeonIds).toEqual(["8", "12", "20"]);

    store.updateLootPrice("1", 12345);
    expect(useCastarynStore.getState().lootPrices).toEqual([
      { itemId: "1", price: 12345 },
    ]);
    useCastarynStore.getState().resetLootPrice("1");
    expect(useCastarynStore.getState().lootPrices).toEqual([]);

    useCastarynStore.getState().saveLootCalculation({
      characterCount: 10,
      doubleReward: false,
      selectedDungeons: [{ id: "8", name: "Терраса снов" }],
      totalDayValue: 100,
      totalWeekValue: 700,
      totalMonthValue: 3000,
    });
    const historyId = useCastarynStore.getState().lootHistory[0]?.id;
    expect(historyId).toBeDefined();
    useCastarynStore.getState().deleteLootCalculation(historyId!);
    expect(useCastarynStore.getState().lootHistory).toEqual([]);
  });

  it("persists bounded interface preferences", () => {
    useCastarynStore.getState().updateInterfaceSettings({
      scale: 110,
      reduceMotion: true,
      compactMode: true,
    });

    expect(useCastarynStore.getState().interfaceSettings).toEqual({
      scale: 110,
      reduceMotion: true,
      compactMode: true,
      primaryShortcut: "Shift+F1",
      undoShortcut: "Shift+G",
      startWithWindows: false,
    });
  });

  it("tracks actual arena rating changes independently by mode", () => {
    const store = useCastarynStore.getState();
    store.setArenaRating("order", 1800);
    store.recordArenaMatch("order", "win", 17);
    store.recordArenaMatch("order", "loss", 9);
    store.setArenaRating("chaos", 1500);
    store.recordArenaMatch("chaos", "win", 23);

    const state = useCastarynStore.getState();
    expect(state.arenaRatings).toEqual({ order: 1808, chaos: 1523 });
    expect(
      state.arenaMatches
        .filter((match) => match.mode === "order")
        .map((match) => match.ratingDelta),
    ).toEqual([-9, 17]);
  });

  it("can amend or remove the latest arena result", () => {
    const store = useCastarynStore.getState();
    store.setArenaRating("order", 1800);
    store.recordArenaMatch("order", "win", 15);
    store.amendLastArenaMatch("order", "loss", 8);

    expect(useCastarynStore.getState().arenaRatings.order).toBe(1792);
    expect(useCastarynStore.getState().arenaMatches[0]).toMatchObject({
      result: "loss",
      ratingBefore: 1800,
      ratingDelta: -8,
      ratingAfter: 1792,
    });

    useCastarynStore.getState().deleteLastArenaMatch("order");
    expect(useCastarynStore.getState().arenaRatings.order).toBe(1800);
    expect(useCastarynStore.getState().arenaMatches).toEqual([]);
  });

  it("tracks imperial battles with optional placement and a timer", () => {
    const store = useCastarynStore.getState();
    store.startImperialBattle();
    vi.advanceTimersByTime(65_000);
    useCastarynStore.getState().tick();
    useCastarynStore.getState().finishImperialBattle();

    const state = useCastarynStore.getState();
    expect(state.activeImperialRun).toBeNull();
    expect(state.imperialBattles[0]).toMatchObject({
      durationSeconds: 65,
      placement: null,
    });

    state.updateImperialPlacement(state.imperialBattles[0]!.id, 7);
    expect(useCastarynStore.getState().imperialBattles[0]?.placement).toBe(7);
  });

  it("does not start an imperial battle while a PvE timer is active", () => {
    const store = useCastarynStore.getState();
    store.completeOnboarding({
      profile: { name: "Player", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    store.startRun(pack.id, pack.dungeons[0]!.id);
    useCastarynStore.getState().startImperialBattle();

    expect(useCastarynStore.getState().activeRun).not.toBeNull();
    expect(useCastarynStore.getState().activeImperialRun).toBeNull();
  });

  it("does not start a PvE timer while an imperial battle is active", () => {
    const store = useCastarynStore.getState();
    store.completeOnboarding({
      profile: { name: "Player", server: "" },
      playMode: "single",
      packCount: 1,
    });
    store.startImperialBattle();
    const pack = useCastarynStore.getState().packs[0]!;
    useCastarynStore.getState().startRun(pack.id, pack.dungeons[0]!.id);

    expect(useCastarynStore.getState().activeImperialRun).not.toBeNull();
    expect(useCastarynStore.getState().activeRun).toBeNull();
  });

  it("cancels an imperial timer without adding a battle", () => {
    useCastarynStore.getState().startImperialBattle();
    vi.advanceTimersByTime(10_000);
    useCastarynStore.getState().tick();
    useCastarynStore.getState().cancelImperialBattle();

    expect(useCastarynStore.getState().activeImperialRun).toBeNull();
    expect(useCastarynStore.getState().imperialBattles).toEqual([]);
  });

  it("bounds imported user values for arena and imperial placement", () => {
    const store = useCastarynStore.getState();
    store.setArenaRating("order", Number.NaN);
    expect(useCastarynStore.getState().arenaRatings.order).toBe(0);

    store.startImperialBattle();
    store.finishImperialBattle(500);
    const battle = useCastarynStore.getState().imperialBattles[0]!;
    expect(battle.placement).toBe(99);
    useCastarynStore
      .getState()
      .updateImperialPlacement(battle.id, Number.NaN);
    expect(useCastarynStore.getState().imperialBattles[0]?.placement).toBe(1);
  });

  it("creates a plan without choosing a pack automatically", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "Phoenix" },
      playMode: "multi",
      packCount: 3,
    });

    const state = useCastarynStore.getState();
    expect(state.packs).toHaveLength(3);
    expect(state.defaultPacks).toHaveLength(3);
    expect(state.selectedPackId).toBe("");
    expect(state.packs.every((pack) => pack.enabled)).toBe(true);
    expect(state.packs[0]?.chestInventoryByDungeon).toEqual({});
    expect(state.packs[0]?.dungeons.map((dungeon) => dungeon.id)).toEqual([
      "dream-terrace-legendary",
      "whispering-tomb",
      "knights-island",
    ]);
  });

  it("keeps temporary pack selection separate from permanent plan", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 2,
    });

    const packId = useCastarynStore.getState().packs[1]?.id;
    expect(packId).toBeDefined();
    useCastarynStore.getState().toggleTodayPack(packId!);

    const state = useCastarynStore.getState();
    expect(state.packs[1]?.enabled).toBe(false);
    expect(state.defaultPacks[1]?.enabled).toBe(true);
  });

  it("prevents starting a completed dungeon twice", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });

    const pack = useCastarynStore.getState().packs[0]!;
    const dungeon = pack.dungeons[0]!;
    useCastarynStore.getState().startRun(pack.id, dungeon.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().finishRun();
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().startRun(pack.id, dungeon.id);

    const state = useCastarynStore.getState();
    expect(state.activeRun).toBeNull();
    expect(state.packs[0]?.dungeons[0]?.status).toBe("completed");
    expect(state.packs[0]?.dungeons[0]?.chests).toBe(3);
    expect(
      state.packs[0]?.chestInventoryByDungeon[dungeon.id],
    ).toEqual([3]);
  });

  it("runs the ordered route with one action and selects the next dungeon", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });

    useCastarynStore.getState().routePrimaryAction();
    expect(useCastarynStore.getState().activeRun?.dungeonId).toBe(
      "dream-terrace-legendary",
    );

    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().routePrimaryAction();
    const state = useCastarynStore.getState();
    expect(state.activeRun).toBeNull();
    expect(state.selectedPackId).toBe("pack-1");
    expect(state.packs[0]?.dungeons[0]?.status).toBe("completed");
    expect(state.packs[0]?.dungeons[1]?.status).toBe("idle");
  });

  it("adds the daily bonus to every rewarded inventory slot", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 1,
    });
    useCastarynStore.setState({ dayKey: "2026-07-30" });

    const pack = useCastarynStore.getState().packs[0]!;
    const armorDungeon = pack.dungeons.find(
      (dungeon) => dungeon.id === "dream-terrace-legendary",
    )!;
    useCastarynStore.getState().startRun(pack.id, armorDungeon.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().finishRun();

    const state = useCastarynStore.getState();
    expect(
      state.packs[0]?.chestInventoryByDungeon[armorDungeon.id],
    ).toEqual(Array(10).fill(3));
    expect(state.packs[0]?.dungeons[0]?.chests).toBe(30);
    expect(state.packs[0]?.dungeons[0]?.dailyCategory).toBe("armor");
  });

  it("undoes an accidental route action", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    useCastarynStore.getState().routePrimaryAction();
    expect(useCastarynStore.getState().activeRun).not.toBeNull();
    useCastarynStore.getState().undoRouteAction();
    expect(useCastarynStore.getState().activeRun).toBeNull();
    expect(useCastarynStore.getState().packs[0]?.dungeons[0]?.status).toBe(
      "idle",
    );
  });

  it("undoes a completed route atomically, including persistent inventory", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    useCastarynStore.getState().routePrimaryAction();
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().routePrimaryAction();
    expect(
      useCastarynStore.getState().defaultPacks[0]
        ?.chestInventoryByDungeon["dream-terrace-legendary"],
    ).toEqual([3]);

    useCastarynStore.getState().undoRouteAction();
    const state = useCastarynStore.getState();
    expect(state.packs[0]?.dungeons[0]?.status).toBe("active");
    expect(
      state.defaultPacks[0]?.chestInventoryByDungeon["dream-terrace-legendary"],
    ).toBeUndefined();
  });

  it("corrects the exact rewarded characters without changing the plan result", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const dungeon = pack.dungeons[0]!;
    useCastarynStore.getState().startRun(pack.id, dungeon.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().finishRun();
    useCastarynStore
      .getState()
      .updateDungeonReward(pack.id, dungeon.id, [1, 4, 8]);

    const state = useCastarynStore.getState();
    expect(state.packs[0]?.dungeons[0]?.rewardedSlotIndexes).toEqual([1, 4, 8]);
    expect(state.packs[0]?.chestInventoryByDungeon[dungeon.id]).toEqual([
      0, 3, 0, 0, 3, 0, 0, 0, 3, 0,
    ]);
    expect(state.defaultPacks[0]?.dungeons[0]?.status).toBe("idle");
    expect(state.defaultPacks[0]?.dungeons[0]?.rewardedSlots).toBe(0);
  });

  it("clears a route undo snapshot after a manual action", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    useCastarynStore.getState().routePrimaryAction();
    useCastarynStore.getState().cancelRun();
    expect(useCastarynStore.getState().lastRouteAction).toBeNull();
  });

  it("never allows removing the last dungeon from a permanent pack", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 1,
    });

    const pack = useCastarynStore.getState().defaultPacks[0]!;
    for (const dungeon of pack.dungeons.slice(1)) {
      const dungeonId = dungeon.id;
      useCastarynStore.getState().toggleDefaultDungeon(pack.id, dungeonId);
    }
    const lastDungeonId =
      useCastarynStore.getState().defaultPacks[0]!.dungeons[0]!.id;
    useCastarynStore
      .getState()
      .toggleDefaultDungeon(pack.id, lastDungeonId);

    expect(useCastarynStore.getState().defaultPacks[0]?.dungeons).toHaveLength(1);
  });

  it("does not remove a pack that contains inventory", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 2,
    });
    useCastarynStore
      .getState()
      .updatePackChestInventory(
        "pack-2",
        "knights-island",
        0,
        7,
      );
    useCastarynStore.getState().setDefaultPackCount(1);
    expect(useCastarynStore.getState().defaultPacks).toHaveLength(2);
  });

  it("allows adding any catalog dungeon only for today", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "multi",
      packCount: 1,
    });
    useCastarynStore
      .getState()
      .toggleTodayDungeon("pack-1", "elements-temple");
    expect(
      useCastarynStore
        .getState()
        .packs[0]?.dungeons.some((dungeon) => dungeon.id === "elements-temple"),
    ).toBe(true);
    expect(
      useCastarynStore
        .getState()
        .defaultPacks[0]?.dungeons.some(
          (dungeon) => dungeon.id === "elements-temple",
        ),
    ).toBe(false);
  });

  it("ignores a repeated route action during the debounce window", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    useCastarynStore.getState().routePrimaryAction();
    useCastarynStore.getState().routePrimaryAction();
    expect(useCastarynStore.getState().activeRun).not.toBeNull();
    expect(useCastarynStore.getState().packs[0]?.dungeons[0]?.status).toBe(
      "active",
    );
  });

  it("protects a manually started dungeon from an immediate route finish", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const dungeon = pack.dungeons[0]!;

    useCastarynStore.getState().startRun(pack.id, dungeon.id);
    useCastarynStore.getState().routePrimaryAction();

    const state = useCastarynStore.getState();
    expect(state.activeRun?.dungeonId).toBe(dungeon.id);
    expect(state.packs[0]?.dungeons[0]?.status).toBe("active");
  });

  it("reopens an accidentally completed dungeon and removes only its reward", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const dungeon = pack.dungeons[0]!;
    useCastarynStore
      .getState()
      .updatePackChestInventory(pack.id, dungeon.id, 0, 7);
    useCastarynStore.getState().startRun(pack.id, dungeon.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().finishRun();

    expect(
      useCastarynStore.getState().packs[0]
        ?.chestInventoryByDungeon[dungeon.id],
    ).toEqual([10]);

    useCastarynStore.getState().reopenDungeon(pack.id, dungeon.id);
    const state = useCastarynStore.getState();
    expect(state.packs[0]?.dungeons[0]?.status).toBe("idle");
    expect(state.packs[0]?.dungeons[0]?.chests).toBe(0);
    expect(
      state.packs[0]?.chestInventoryByDungeon[dungeon.id],
    ).toEqual([7]);
    expect(
      state.defaultPacks[0]?.chestInventoryByDungeon[dungeon.id],
    ).toEqual([7]);
  });

  it("resets all of today's completed progress without erasing old inventory", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const first = pack.dungeons[0]!;
    const second = pack.dungeons[1]!;
    useCastarynStore
      .getState()
      .updatePackChestInventory(pack.id, first.id, 0, 4);

    for (const dungeon of [first, second]) {
      useCastarynStore.getState().startRun(pack.id, dungeon.id);
      useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
      useCastarynStore.getState().finishRun();
      useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    }

    useCastarynStore.getState().resetTodayProgress();
    const state = useCastarynStore.getState();
    expect(
      state.packs[0]?.dungeons.every(
        (dungeon) => dungeon.status === "idle",
      ),
    ).toBe(true);
    expect(state.packs[0]?.chestInventoryByDungeon[first.id]).toEqual([4]);
    expect(state.packs[0]?.chestInventoryByDungeon[second.id]).toEqual([0]);
  });

  it("uses the configured permanent route order for today's route", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().defaultPacks[0]!;
    const secondDungeon = pack.dungeons[1]!;
    useCastarynStore
      .getState()
      .moveDefaultDungeon(pack.id, secondDungeon.id, "up");

    const state = useCastarynStore.getState();
    expect(state.defaultPacks[0]?.dungeons[0]?.id).toBe(secondDungeon.id);
    expect(state.packs[0]?.dungeons[0]?.id).toBe(secondDungeon.id);

    useCastarynStore.getState().routePrimaryAction();
    expect(useCastarynStore.getState().activeRun?.dungeonId).toBe(
      secondDungeon.id,
    );
  });

  it("chooses a different next dungeon without resetting progress or permanent order", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const first = pack.dungeons[0]!;
    const chosen = pack.dungeons[2]!;
    const permanentOrder = useCastarynStore
      .getState()
      .defaultPacks[0]!.dungeons.map((dungeon) => dungeon.id);

    useCastarynStore.getState().startRun(pack.id, first.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().finishRun();
    const completedChests = useCastarynStore.getState().packs[0]!.dungeons[0]!.chests;
    useCastarynStore
      .getState()
      .chooseNextRouteDungeon(pack.id, chosen.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().routePrimaryAction();

    const state = useCastarynStore.getState();
    expect(state.activeRun?.dungeonId).toBe(chosen.id);
    expect(state.packs[0]?.dungeons[0]?.status).toBe("completed");
    expect(state.packs[0]?.dungeons[0]?.chests).toBe(completedChests);
    expect(state.defaultPacks[0]?.dungeons.map((dungeon) => dungeon.id)).toEqual(
      permanentOrder,
    );
  });

  it("keeps a next-dungeon choice made while the current dungeon is running", () => {
    useCastarynStore.getState().completeOnboarding({
      profile: { name: "Streamer", server: "" },
      playMode: "single",
      packCount: 1,
    });
    const pack = useCastarynStore.getState().packs[0]!;
    const current = pack.dungeons[0]!;
    const chosen = pack.dungeons[2]!;

    useCastarynStore.getState().startRun(pack.id, current.id);
    useCastarynStore
      .getState()
      .chooseNextRouteDungeon(pack.id, chosen.id);
    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().routePrimaryAction();

    let state = useCastarynStore.getState();
    expect(state.activeRun).toBeNull();
    expect(state.nextRouteTarget).toEqual({
      packId: pack.id,
      dungeonId: chosen.id,
    });
    expect(state.packs[0]?.dungeons[0]?.status).toBe("completed");

    useCastarynStore.setState({ routeActionLockedUntilMs: 0 });
    useCastarynStore.getState().routePrimaryAction();
    state = useCastarynStore.getState();
    expect(state.activeRun?.dungeonId).toBe(chosen.id);
  });
});
