import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  CaretDown,
  Check,
  Clock,
  Calculator,
  Copy,
  Database,
  DotsSixVertical,
  GearSix,
  Gift,
  House,
  Keyboard,
  ListChecks,
  Minus,
  Monitor,
  Package,
  Play,
  Plus,
  Plug,
  Question,
  Rows,
  SidebarSimple,
  Stop,
  Sword,
  User,
  UserCircle,
  UsersThree,
  X,
  CornersOut,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Theme } from "@radix-ui/themes";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  dungeonCategories,
  dungeonCatalog,
  featuredDungeonIds,
  getPackChestTotal,
  type DungeonStatus,
  type Pack,
  useCastarynStore,
} from "./store/castaryn-store";
import { IntegrationsView as CreatorIntegrationsView } from "./views/IntegrationsView";
import { CreatorBackgroundSync } from "./components/CreatorBackgroundSync";
import { EventsEffectLayer } from "./components/EventsEffectLayer";
import { PageHeading } from "./components/PageHeading";
import { AppSelect } from "./components/AppSelect";
import { HelpView } from "./views/HelpView";
import { LootCalculatorView } from "./views/LootCalculatorView";
import { PvpView } from "./views/PvpView";
import {
  dailyDungeonCategoryLabels,
  getDailyDungeonCategoryFromAnchor,
} from "./domain/daily-dungeon-cycle";
import {
  shortcutStatusEvent,
  useShortcutStatus,
} from "./components/shortcut-status";
import {
  storageStatusEvent,
  type StorageStatus,
} from "./lib/desktop-storage";
import { formatDuration } from "./domain/format-duration";
import {
  isCurrentPerfectWorldServer,
  perfectWorldServers,
} from "./domain/perfect-world-servers";

type View =
  | "today"
  | "history"
  | "loot"
  | "pvp"
  | "integrations"
  | "help"
  | "settings";

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof House;
}> = [
  { id: "today", label: "Сегодня", icon: House },
  { id: "history", label: "История", icon: Rows },
  { id: "loot", label: "Фарм", icon: Calculator },
  { id: "pvp", label: "PvP", icon: Sword },
  { id: "integrations", label: "Стриминг", icon: Plug },
  { id: "help", label: "Помощь", icon: Question },
  { id: "settings", label: "Настройки", icon: GearSix },
];

const numberFormatter = new Intl.NumberFormat("ru-RU");

function StatusIcon({ status }: { status: DungeonStatus }) {
  if (status === "completed") {
    return (
      <span className="status-icon status-icon--complete" aria-label="Завершён">
        <Check size={14} weight="bold" />
      </span>
    );
  }

  if (status === "active") {
    return (
      <span className="status-icon status-icon--active" aria-label="В процессе">
        <Play size={13} weight="fill" />
      </span>
    );
  }

  return <span className="status-icon" aria-label="Не начат" />;
}

function App() {
  const [view, setView] = useState<View>("today");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("saved");
  const [focusPanel, setFocusPanel] = useState(false);
  const systemReduceMotion = useReducedMotion();
  const interfaceSettings = useCastarynStore(
    (state) => state.interfaceSettings,
  );
  const reduceMotion =
    Boolean(systemReduceMotion) || interfaceSettings.reduceMotion;
  const profile = useCastarynStore((state) => state.profile);
  const activeRun = useCastarynStore((state) => state.activeRun);
  const activeImperialRun = useCastarynStore(
    (state) => state.activeImperialRun,
  );
  const tick = useCastarynStore((state) => state.tick);
  const ensureCurrentDay = useCastarynStore((state) => state.ensureCurrentDay);
  const hasHydrated = useCastarynStore((state) => state.hasHydrated);
  const onboardingCompleted = useCastarynStore(
    (state) => state.onboardingCompleted,
  );

  useEffect(() => {
    if (!activeRun && !activeImperialRun) return;
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [activeRun, activeImperialRun, tick]);

  useEffect(() => {
    ensureCurrentDay();
    const interval = window.setInterval(ensureCurrentDay, 30_000);
    return () => window.clearInterval(interval);
  }, [ensureCurrentDay]);

  useEffect(() => {
    const handleStorageStatus = (event: Event) => {
      setStorageStatus((event as CustomEvent<StorageStatus>).detail);
    };
    window.addEventListener(storageStatusEvent, handleStorageStatus);
    return () =>
      window.removeEventListener(storageStatusEvent, handleStorageStatus);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--interface-scale",
      String(interfaceSettings.scale / 100),
    );
    document.body.classList.toggle(
      "compact-interface",
      interfaceSettings.compactMode,
    );
  }, [interfaceSettings]);

  useEffect(() => {
    const toggle = () => setFocusPanel((value) => !value);
    window.addEventListener("castaryn-toggle-focus-panel", toggle);
    return () =>
      window.removeEventListener("castaryn-toggle-focus-panel", toggle);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    void (async () => {
      await appWindow.unmaximize();
      await appWindow.setMinSize(
        new LogicalSize(focusPanel ? 460 : 960, focusPanel ? 370 : 680),
      );
      await appWindow.setAlwaysOnTop(focusPanel);
      await appWindow.setDecorations(!focusPanel);
      await appWindow.setResizable(!focusPanel);
      await appWindow.setSize(
        new LogicalSize(focusPanel ? 460 : 1280, focusPanel ? 370 : 820),
      );
      await appWindow.center();
    })();
  }, [focusPanel]);

  useEffect(() => {
    if (!focusPanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusPanel(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusPanel]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "focus-panel-mode",
      focusPanel,
    );
    return () =>
      document.documentElement.classList.remove("focus-panel-mode");
  }, [focusPanel]);

  if (!hasHydrated) {
    return (
      <Theme appearance="dark" accentColor="teal" grayColor="slate" radius="medium">
        <div className="launch-screen">
          <img src="/castaryn-icon.png" alt="" />
          <span>Подготавливаем Castaryn…</span>
        </div>
      </Theme>
    );
  }

  if (!onboardingCompleted) {
    return (
      <Theme appearance="dark" accentColor="teal" grayColor="slate" radius="medium">
        <Onboarding />
      </Theme>
    );
  }

  if (focusPanel) {
    return (
      <Theme appearance="dark" accentColor="teal" grayColor="slate" radius="medium">
        <CompactFarmPanel onExpand={() => setFocusPanel(false)} />
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="teal" grayColor="slate" radius="medium">
      <div className={sidebarCollapsed ? "app app--collapsed" : "app"}>
        <CreatorBackgroundSync />
        <EventsEffectLayer />
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <img src="/castaryn-icon.png" alt="" />
            </div>
            <div className="brand-copy">
              <strong>Castaryn</strong>
              <span>Perfect World</span>
            </div>
          </div>

          <nav className="primary-nav" aria-label="Основная навигация">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  className={view === item.id ? "nav-item nav-item--active" : "nav-item"}
                  key={item.id}
                  onClick={() => setView(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon size={19} weight={view === item.id ? "fill" : "regular"} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="profile-chip">
              <div className="profile-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
              <div className="profile-copy">
                <strong>{profile.name}</strong>
                <span>{profile.server || "Сервер не указан"}</span>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"}
            >
              <SidebarSimple size={19} />
            </button>
          </div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div className="game-context">
              <Sword size={18} weight="fill" />
              <span>Perfect World</span>
              <CaretDown size={14} />
            </div>
            <div className="topbar-actions">
              <div
                className={
                  storageStatus === "error"
                    ? "sync-state sync-state--error"
                    : "sync-state"
                }
                role="status"
              >
                <span className="sync-state__dot" />
                {storageStatus === "saving"
                  ? "Сохраняем локально…"
                  : storageStatus === "error"
                    ? "Ошибка локального сохранения"
                    : "Локальные данные сохранены"}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Открыть профиль"
                onClick={() => setView("settings")}
              >
                <UserCircle size={21} />
              </button>
            </div>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="view"
              key={view}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {view === "today" && <TodayView />}
              {view === "history" && <HistoryView />}
              {view === "loot" && <LootCalculatorView />}
              {view === "pvp" && <PvpView />}
              {view === "integrations" && <IntegrationsView />}
              {view === "help" && <HelpView />}
              {view === "settings" && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </Theme>
  );
}

function CompactFarmPanel({ onExpand }: { onExpand: () => void }) {
  const packs = useCastarynStore((state) => state.packs);
  const selectedPackId = useCastarynStore((state) => state.selectedPackId);
  const nextRouteTarget = useCastarynStore((state) => state.nextRouteTarget);
  const chooseNextRouteDungeon = useCastarynStore(
    (state) => state.chooseNextRouteDungeon,
  );
  const activeRun = useCastarynStore((state) => state.activeRun);
  const activeImperialRun = useCastarynStore(
    (state) => state.activeImperialRun,
  );
  const finishImperialBattle = useCastarynStore(
    (state) => state.finishImperialBattle,
  );
  const dayKey = useCastarynStore((state) => state.dayKey);
  const override = useCastarynStore((state) => state.dailyCategoryOverride);
  const routePrimaryAction = useCastarynStore(
    (state) => state.routePrimaryAction,
  );
  const undoRouteAction = useCastarynStore((state) => state.undoRouteAction);
  const canUndo = useCastarynStore((state) => state.lastRouteAction !== null);
  const shortcuts = useCastarynStore((state) => state.interfaceSettings);
  const shortcutStatus = useShortcutStatus();

  const currentPack = activeRun
    ? packs.find((pack) => pack.id === activeRun.packId)
    : packs.find((pack) => pack.id === selectedPackId);
  const availableDungeons =
    currentPack?.dungeons.filter((dungeon) => dungeon.status === "idle") ?? [];
  const preferredDungeon = availableDungeons.find(
    (dungeon) =>
      nextRouteTarget?.packId === currentPack?.id &&
      nextRouteTarget?.dungeonId === dungeon.id,
  );
  const currentDungeon = activeRun
    ? currentPack?.dungeons.find(
        (dungeon) => dungeon.id === activeRun.dungeonId,
      )
    : preferredDungeon ?? availableDungeons[0];
  const dailyCategory = getDailyDungeonCategoryFromAnchor(dayKey, override);
  const inventory = packs.reduce((sum, pack) => sum + getPackChestTotal(pack), 0);

  return (
    <main className="focus-panel">
      <header
        className="focus-panel__header"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          ) {
            return;
          }
          if (isTauri()) void getCurrentWindow().startDragging();
        }}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) onExpand();
        }}
      >
        <div className="focus-panel__brand" data-tauri-drag-region>
          <DotsSixVertical
            className="focus-panel__drag-icon"
            size={18}
            aria-hidden="true"
          />
          <img src="/castaryn-icon.png" alt="" />
          <span>
            {activeImperialRun
              ? "Императорская битва"
              : currentPack?.name ?? "Маршрут готов"}
          </span>
        </div>
        <div className="focus-panel__window-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onExpand}
            aria-label="Вернуться в Castaryn"
            title="Вернуться в Castaryn"
          >
            <CornersOut size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (isTauri()) {
                void getCurrentWindow().close();
              } else {
                onExpand();
              }
            }}
            aria-label="Закрыть Castaryn"
            title="Закрыть Castaryn"
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <section className="focus-panel__body">
        <span
          className={
            activeRun || activeImperialRun
              ? "focus-status is-live"
              : "focus-status"
          }
        >
          {activeRun || activeImperialRun
            ? "Таймер запущен"
            : "Следующий данж"}
        </span>
        <strong>
          {activeImperialRun
            ? "Императорская битва"
            : currentDungeon?.name ?? "Маршрут завершён"}
        </strong>
        <div className="focus-panel__meta">
          <span>
            {activeImperialRun
              ? formatDuration(activeImperialRun.elapsedSeconds)
              : activeRun
                ? formatDuration(activeRun.elapsedSeconds)
                : "Готов к старту"}
          </span>
          {activeImperialRun ? (
            <span>Место можно добавить после боя</span>
          ) : (
            <>
              <span>Ежа: {dailyDungeonCategoryLabels[dailyCategory]}</span>
              <span>{inventory} сундуков в инвентаре</span>
            </>
          )}
        </div>
        {!activeImperialRun && currentPack && availableDungeons.length > 1 && (
          <label className="focus-panel__next-dungeon">
            <span>{activeRun ? "После завершения" : "Следующий данж"}</span>
            <AppSelect
              ariaLabel="Выбрать следующий данж"
              value={preferredDungeon?.id ?? availableDungeons[0]!.id}
              onValueChange={(dungeonId) =>
                chooseNextRouteDungeon(currentPack.id, dungeonId)
              }
              options={availableDungeons.map((dungeon) => ({
                value: dungeon.id,
                label: dungeon.name,
              }))}
            />
          </label>
        )}
      </section>
      <footer className="focus-panel__actions">
        <div className="focus-panel__shortcut-status" role="status">
          <span className={`shortcut-dot is-${shortcutStatus.status}`} />
          {shortcutStatus.status === "ready"
            ? `${shortcuts.primaryShortcut} активна`
            : shortcutStatus.status === "checking"
              ? "Подключаем горячую клавишу"
              : "Горячая клавиша не активна"}
        </div>
        <div className="focus-panel__action-row">
          <button
            type="button"
            className="primary-button"
            disabled={!activeImperialRun && !currentDungeon}
            onClick={() =>
              activeImperialRun
                ? finishImperialBattle(null)
                : routePrimaryAction()
            }
          >
            {activeRun || activeImperialRun ? (
              <Check size={17} />
            ) : (
              <Play size={16} weight="fill" />
            )}
            {activeImperialRun
              ? "Завершить бой"
              : activeRun
                ? "Завершить и дальше"
                : "Начать"}
            <kbd>{shortcuts.primaryShortcut}</kbd>
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!canUndo}
            onClick={undoRouteAction}
            aria-label={`Отменить последнее действие (${shortcuts.undoShortcut})`}
          >
            <ArrowCounterClockwise size={18} />
          </button>
        </div>
      </footer>
    </main>
  );
}

function Onboarding() {
  const completeOnboarding = useCastarynStore(
    (state) => state.completeOnboarding,
  );
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [playMode, setPlayMode] = useState<"single" | "multi">("multi");
  const [packCount, setPackCount] = useState(1);

  const canContinue = step !== 1 || name.trim().length > 0;

  return (
    <main className="onboarding-shell">
      <div className="onboarding-glow" />
      <section className="onboarding-card">
        <header className="onboarding-header">
          <div className="onboarding-brand">
            <img src="/castaryn-icon.png" alt="" />
            <div>
              <strong>Castaryn</strong>
              <span>Настройка Perfect World</span>
            </div>
          </div>
          <span className="onboarding-step">Шаг {step} из 3</span>
        </header>

        <div className="onboarding-progress" aria-hidden="true">
          {[1, 2, 3].map((item) => (
            <span key={item} className={item <= step ? "is-active" : ""} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            className="onboarding-content"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.18 }}
          >
            {step === 1 && (
              <>
                <div className="onboarding-title">
                  <span className="eyebrow">Профиль</span>
                  <h1>Как к вам обращаться?</h1>
                  <p>Имя будет отображаться только внутри Castaryn и в выбранных командах стрима.</p>
                </div>
                <div className="onboarding-fields">
                  <label>
                    <span>Имя или ник</span>
                    <input
                      autoFocus
                      maxLength={64}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Введите имя или ник"
                    />
                  </label>
                  <div className="onboarding-field">
                    <span>Сервер <em>необязательно</em></span>
                    <AppSelect
                      ariaLabel="Сервер Perfect World"
                      className="onboarding-app-select"
                      value={server}
                      onValueChange={setServer}
                      options={[
                        { value: "", label: "Не выбран" },
                        ...perfectWorldServers.map((serverName) => ({
                          value: serverName,
                          label: serverName,
                        })),
                      ]}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="onboarding-title">
                  <span className="eyebrow">Режим игры</span>
                  <h1>Как вы проходите PvE?</h1>
                  <p>Это изменит названия и структуру экрана «Сегодня».</p>
                </div>
                <div className="mode-grid">
                  <button
                    type="button"
                    className={playMode === "single" ? "mode-card is-selected" : "mode-card"}
                    onClick={() => setPlayMode("single")}
                  >
                    <User size={26} />
                    <strong>Один персонаж</strong>
                    <span>Один список данжей без пачек.</span>
                  </button>
                  <button
                    type="button"
                    className={playMode === "multi" ? "mode-card is-selected" : "mode-card"}
                    onClick={() => setPlayMode("multi")}
                  >
                    <Monitor size={26} />
                    <strong>10 окон</strong>
                    <span>Основа и твины, собранные в одну или несколько пачек.</span>
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="onboarding-title">
                  <span className="eyebrow">Структура</span>
                  <h1>{playMode === "single" ? "Всё готово" : "Сколько у вас пачек?"}</h1>
                  <p>
                    {playMode === "single"
                      ? "Создадим один список актуальных данжей."
                      : "Castaryn создаст их автоматически. Названия можно изменить позже."}
                  </p>
                </div>
                {playMode === "multi" ? (
                  <div className="pack-counter">
                    <button
                      type="button"
                      aria-label="Уменьшить количество пачек"
                      onClick={() => setPackCount((value) => Math.max(1, value - 1))}
                    >
                      <Minus size={20} />
                    </button>
                    <div>
                      <strong>{packCount}</strong>
                      <span>{packCount === 1 ? "пачка" : packCount < 5 ? "пачки" : "пачек"}</span>
                    </div>
                    <button
                      type="button"
                      aria-label="Увеличить количество пачек"
                      onClick={() => setPackCount((value) => Math.min(20, value + 1))}
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="single-ready">
                    <UsersThree size={28} />
                    <span>Данжи уже добавлены. Их список можно изменить в плане дня.</span>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <footer className="onboarding-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={step === 1}
            onClick={() => setStep((value) => Math.max(1, value - 1))}
          >
            <ArrowLeft size={17} />
            Назад
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canContinue}
              onClick={() => setStep((value) => Math.min(3, value + 1))}
            >
              Продолжить
              <ArrowRight size={17} />
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                completeOnboarding({
                  profile: { name: name.trim(), server: server.trim() },
                  playMode,
                  packCount,
                })
              }
            >
              Открыть Castaryn
              <ArrowRight size={17} />
            </button>
          )}
        </footer>
      </section>
      <p className="onboarding-footnote">
        Castaryn не подключается к игровому клиенту. Все данные остаются на этом компьютере.
      </p>
    </main>
  );
}

function TodayView() {
  const [planOpen, setPlanOpen] = useState(false);
  const packs = useCastarynStore((state) => state.packs);
  const selectedPackId = useCastarynStore((state) => state.selectedPackId);
  const selectPack = useCastarynStore((state) => state.selectPack);
  const activeRun = useCastarynStore((state) => state.activeRun);
  const startRun = useCastarynStore((state) => state.startRun);
  const cancelRun = useCastarynStore((state) => state.cancelRun);
  const toggleTodayDungeon = useCastarynStore(
    (state) => state.toggleTodayDungeon,
  );
  const toggleTodayPack = useCastarynStore((state) => state.toggleTodayPack);
  const completePack = useCastarynStore((state) => state.completePack);
  const dayKey = useCastarynStore((state) => state.dayKey);
  const gameTimeZone = useCastarynStore((state) => state.gameTimeZone);
  const dailyOverride = useCastarynStore(
    (state) => state.dailyCategoryOverride,
  );
  const setDailyCategoryOverride = useCastarynStore(
    (state) => state.setDailyCategoryOverride,
  );
  const routePrimaryAction = useCastarynStore(
    (state) => state.routePrimaryAction,
  );
  const undoRouteAction = useCastarynStore((state) => state.undoRouteAction);
  const resetTodayProgress = useCastarynStore(
    (state) => state.resetTodayProgress,
  );
  const canUndo = useCastarynStore((state) => state.lastRouteAction !== null);
  const primaryShortcut = useCastarynStore(
    (state) => state.interfaceSettings.primaryShortcut,
  );
  const dailyCategory = getDailyDungeonCategoryFromAnchor(
    dayKey,
    dailyOverride,
  );
  const hasRecordedProgress = packs.some(
    (pack) =>
      pack.completedManually ||
      pack.dungeons.some((dungeon) => dungeon.status === "completed"),
  );

  const selectedPack = packs.find(
    (pack) =>
      pack.id === selectedPackId && pack.enabled && !pack.completedManually,
  );
  const enabledPacks = packs.filter((pack) => pack.enabled);
  const activePack = activeRun
    ? packs.find((pack) => pack.id === activeRun.packId)
    : undefined;
  const activeDungeon = activePack?.dungeons.find(
    (dungeon) => dungeon.id === activeRun?.dungeonId,
  );

  const summary = useMemo(() => {
    const dungeons = enabledPacks.flatMap((pack) => pack.dungeons);
    const completedDungeons = dungeons.filter(
      (dungeon) => dungeon.status === "completed",
    );
    const completedPacks = enabledPacks.filter(
      (pack) =>
        pack.completedManually ||
        (pack.dungeons.length > 0 &&
          pack.dungeons.every((dungeon) => dungeon.status === "completed")),
    );
    return {
      completedPacks: completedPacks.length,
      completedDungeons: completedDungeons.length,
      totalDungeons: dungeons.length,
      chests: completedDungeons.reduce(
        (sum, dungeon) => sum + dungeon.chests,
        0,
      ),
      duration: completedDungeons.reduce(
        (sum, dungeon) => sum + dungeon.durationSeconds,
        0,
      ),
    };
  }, [enabledPacks]);

  const todayLabel = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: gameTimeZone,
  }).format(new Date());

  return (
    <>
      <PageHeading
        title="Сегодня"
        description={`${todayLabel}. Ваш текущий PvE-прогресс.`}
        action={
          <div className="page-heading-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                window.dispatchEvent(
                  new Event("castaryn-toggle-focus-panel"),
                )
              }
            >
              <CornersOut size={17} />
              Мини-панель
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPlanOpen(true)}
            >
              <ListChecks size={18} />
              Изменить план
            </button>
            <button
              type="button"
              className="danger-ghost-button"
              disabled={activeRun !== null || !hasRecordedProgress}
              onClick={() => {
                if (
                  window.confirm(
                    "Сбросить все отметки прохождения за сегодня? Начисленные сегодня сундуки будут вычтены, постоянный план и старый запас сохранятся.",
                  )
                ) {
                  resetTodayProgress();
                }
              }}
            >
              <ArrowCounterClockwise size={17} />
              Сбросить прогресс
            </button>
          </div>
        }
      />

      <section className="route-control">
        <div className="route-control__daily">
          <span>Цикл ежедневок</span>
          <AppSelect
            ariaLabel="Категория сегодняшней ежи"
            value={dailyCategory}
            disabled={activeRun !== null}
            onValueChange={(value) =>
              setDailyCategoryOverride(value as "armor" | "weapon" | "relic")
            }
            options={[
              { value: "armor", label: "Доспехи" },
              { value: "relic", label: "Реликвии" },
              { value: "weapon", label: "Оружие" },
            ]}
          />
          {activeRun && (
            <small>Категорию можно изменить после завершения текущего данжа.</small>
          )}
          {!activeRun && dailyOverride && (
            <button
              type="button"
              className="text-button"
              onClick={() => setDailyCategoryOverride(null)}
            >
              Вернуть стандартный цикл
            </button>
          )}
          {!activeRun && (
            <small>
              Выбор категории для сегодняшнего дня перестраивает последующий
              трёхдневный цикл.
            </small>
          )}
        </div>
        <div className="route-control__actions">
          <button
            type="button"
            className="primary-button"
            onClick={routePrimaryAction}
          >
            {activeRun ? <Check size={17} /> : <Play size={16} weight="fill" />}
            {activeRun ? "Завершить и выбрать следующий" : "Начать по маршруту"}
            <kbd>{primaryShortcut}</kbd>
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!canUndo}
            onClick={undoRouteAction}
          >
            <ArrowCounterClockwise size={17} />
            Отменить последнее действие
          </button>
        </div>
      </section>

      <section className="today-stage" aria-label="Текущий прогресс">
        <div className={activeRun ? "live-panel live-panel--active" : "live-panel"}>
          <div className="panel-heading">
            <span>Сейчас</span>
            {activeRun && <span className="live-badge">Таймер запущен</span>}
          </div>

          {activeRun && activeDungeon && activePack ? (
            <div className="live-content">
              <div className="live-meta">
                <span>{activePack.name}</span>
                <strong>{activeDungeon.name}</strong>
              </div>
              <div className="timer">{formatDuration(activeRun.elapsedSeconds)}</div>
              <div className="live-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={routePrimaryAction}
                >
                  <Check size={18} weight="bold" />
                  Завершить и выбрать следующий
                </button>
                <button type="button" className="danger-ghost-button" onClick={cancelRun}>
                  <Stop size={17} weight="fill" />
                  Отменить
                </button>
              </div>
            </div>
          ) : (
            <div className="live-empty">
              <div className="live-empty__icon">
                <Play size={25} weight="fill" />
              </div>
              <div>
                <strong>Нет активного данжа</strong>
                <p>Выберите пачку и запустите нужный данж.</p>
              </div>
            </div>
          )}
        </div>

        <div className="metrics">
          <Metric
            label="Пачки"
            value={`${summary.completedPacks} / ${enabledPacks.length}`}
            icon={Rows}
          />
          <Metric
            label="Данжи"
            value={`${summary.completedDungeons} / ${summary.totalDungeons}`}
            icon={Check}
          />
          <Metric
            label="Сундуки"
            value={numberFormatter.format(summary.chests)}
            icon={Gift}
          />
          <Metric
            label="Чистое время"
            value={formatDuration(summary.duration)}
            icon={Clock}
          />
        </div>
      </section>

      <section className="packs-section">
        <div className="section-heading">
          <div>
            <h2>Пачки</h2>
            <p>Выберите пачку, затем запустите любой доступный данж.</p>
          </div>
        </div>

        <div className="farm-layout">
          <div className="pack-tabs" role="tablist" aria-label="Пачки">
            {packs.map((pack, index) => {
              const completed = pack.dungeons.filter(
                (dungeon) => dungeon.status === "completed",
              ).length;
              const hasActive = pack.dungeons.some(
                (dungeon) => dungeon.status === "active",
              );
              return (
                <button
                  type="button"
                  key={pack.id}
                  role="tab"
                  aria-selected={pack.id === selectedPack?.id}
                  className={
                    pack.id === selectedPack?.id
                      ? "pack-tab pack-tab--active"
                      : pack.enabled
                        ? "pack-tab"
                        : "pack-tab pack-tab--disabled"
                  }
                  disabled={!pack.enabled || pack.completedManually}
                  onClick={() => selectPack(pack.id)}
                >
                  <span className="pack-tab__index">
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <span className="pack-tab__copy">
                    <span className="pack-tab__name">{pack.name}</span>
                    <span className="pack-tab__progress">
                      {!pack.enabled
                        ? "Не используется сегодня"
                        : pack.completedManually
                          ? "Завершена вручную"
                          : hasActive
                            ? "В процессе"
                            : `${completed} из ${pack.dungeons.length}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selectedPack ? (
            <div className="selected-pack">
              <div className="selected-pack__actions">
                <strong>{selectedPack.name}</strong>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={activeRun !== null}
                  onClick={() => completePack(selectedPack.id)}
                >
                  Завершить пачку
                </button>
              </div>
              <ChestInventory pack={selectedPack} />
              <DungeonList
                pack={selectedPack}
                activeRun={activeRun}
                onStart={(dungeonId) => {
                  startRun(selectedPack.id, dungeonId);
                  window.scrollTo({ top: 0, behavior: "auto" });
                }}
              />
            </div>
          ) : (
            <div className="pack-selection-empty">
              <Rows size={26} />
              <strong>Выберите пачку</strong>
              <span>
                Горячая клавиша проходит маршрут сверху вниз. Порядок меняется
                в постоянном плане.
              </span>
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {planOpen && (
          <motion.div
            className="dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={() => setPlanOpen(false)}
          >
            <motion.section
              className="plan-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="plan-dialog-title"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <span className="eyebrow">Только сегодня</span>
                  <h2 id="plan-dialog-title">Изменить план</h2>
                  <p>Выберите данжи для каждой пачки. Постоянный план не изменится.</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Закрыть"
                  onClick={() => setPlanOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="plan-dialog__body">
                {packs.map((pack) => {
                  const renderDungeonOption = (
                    [dungeonId, dungeonName]: (typeof dungeonCatalog)[number],
                  ) => {
                    const todayDungeon = pack.dungeons.find(
                      (item) => item.id === dungeonId,
                    );
                    const locked =
                      todayDungeon !== undefined &&
                      todayDungeon.status !== "idle";
                    return (
                      <label key={dungeonId}>
                        <input
                          type="checkbox"
                          checked={todayDungeon !== undefined}
                          disabled={!pack.enabled || locked || activeRun !== null}
                          onChange={() =>
                            toggleTodayDungeon(pack.id, dungeonId)
                          }
                        />
                        <span>{dungeonName}</span>
                        {locked && <em>уже начат</em>}
                      </label>
                    );
                  };
                  const featured = dungeonCatalog.filter(([dungeonId]) =>
                    featuredDungeonIds.includes(
                      dungeonId as (typeof featuredDungeonIds)[number],
                    ),
                  );
                  const catalog = dungeonCatalog.filter(
                    ([dungeonId]) =>
                      !featuredDungeonIds.includes(
                        dungeonId as (typeof featuredDungeonIds)[number],
                      ),
                  );
                  return (
                    <div className="plan-pack" key={pack.id}>
                      <label className="plan-pack__toggle">
                        <input
                          type="checkbox"
                          checked={pack.enabled}
                          disabled={
                            activeRun !== null ||
                            pack.dungeons.some(
                              (dungeon) => dungeon.status !== "idle",
                            )
                          }
                          onChange={() => toggleTodayPack(pack.id)}
                        />
                        <strong>{pack.name}</strong>
                        <span>Использовать сегодня</span>
                      </label>
                      <div>
                        {featured.map(renderDungeonOption)}
                        <details className="plan-pack__catalog">
                          <summary>Другие данжи ({catalog.length})</summary>
                          <div>{catalog.map(renderDungeonOption)}</div>
                        </details>
                      </div>
                    </div>
                  );
                })}
              </div>
              <footer>
                <span>Изменения сохраняются автоматически</span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setPlanOpen(false)}
                >
                  Готово
                </button>
              </footer>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ChestInventory({ pack }: { pack: Pack }) {
  const updateInventory = useCastarynStore(
    (state) => state.updatePackChestInventory,
  );
  const playMode = useCastarynStore((state) => state.playMode);
  const total = getPackChestTotal(pack);
  const slotCount = playMode === "single" ? 1 : 10;
  const visibleDungeonIds = [
    ...new Set([
      ...pack.dungeons.map((dungeon) => dungeon.id),
      ...Object.keys(pack.chestInventoryByDungeon),
    ]),
  ];
  const dungeonNames = new Map(
    dungeonCatalog.map(([id, name]) => [id as string, name as string]),
  );
  const groups = visibleDungeonIds.map((dungeonId) => ({
      id: dungeonId,
      name: dungeonNames.get(dungeonId) ?? dungeonId,
      slots:
        pack.chestInventoryByDungeon[dungeonId] ??
        Array.from({ length: slotCount }, () => 0),
    }));

  return (
    <details className="chest-inventory">
      <summary>
        <span>
          <Package size={18} />
          Инвентарь сундуков
        </span>
        <strong>{total}</strong>
      </summary>
      {groups.map((group) => (
        <section key={group.id} className="chest-inventory__group">
          <strong>{group.name}</strong>
          <div className="chest-inventory__grid">
            {group.slots.map((value, index) => (
              <label key={`${pack.id}-${group.id}-${index}`}>
                <span>{slotCount === 1 ? "Персонаж" : `Твин ${index + 1}`}</span>
                <input
                  type="number"
                  min={0}
                  max={999999}
                  value={value}
                  onChange={(event) =>
                    updateInventory(
                      pack.id,
                      group.id,
                      index,
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </details>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  wide = false,
}: {
  label: string;
  value: string;
  icon: typeof Rows;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "metric metric--wide" : "metric"}>
      <div className="metric__icon">
        <Icon size={17} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DungeonList({
  pack,
  activeRun,
  onStart,
}: {
  pack: Pack;
  activeRun: { packId: string; dungeonId: string } | null;
  onStart: (dungeonId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingRewardId, setEditingRewardId] = useState<string | null>(null);
  const [rewardDraft, setRewardDraft] = useState<number[]>([]);
  const playMode = useCastarynStore((state) => state.playMode);
  const updateDungeonReward = useCastarynStore(
    (state) => state.updateDungeonReward,
  );
  const reopenDungeon = useCastarynStore((state) => state.reopenDungeon);
  const maxRewardedSlots = playMode === "single" ? 1 : 10;

  return (
    <div className="dungeon-list">
      <div className="dungeon-list__header">
        <span>Данж</span>
        <span>Статус</span>
        <span>Время</span>
        <span />
      </div>
      {pack.dungeons.map((dungeon) => {
        const isExpanded = expandedId === dungeon.id;
        const isAnotherRunActive =
          activeRun !== null &&
          (activeRun.packId !== pack.id || activeRun.dungeonId !== dungeon.id);
        return (
          <div className="dungeon-row-wrap" key={dungeon.id}>
            <div
              className="dungeon-row"
            >
              <div className="dungeon-name">
                <StatusIcon status={dungeon.status} />
                <div>
                  <strong>{dungeon.name}</strong>
                  <span>{dungeon.category}</span>
                </div>
              </div>
              <span className={`status-label status-label--${dungeon.status}`}>
                {dungeon.status === "completed"
                  ? "Завершён"
                  : dungeon.status === "active"
                    ? "В процессе"
                    : "Не начат"}
              </span>
              <span className="row-time">
                {dungeon.durationSeconds > 0
                  ? formatDuration(dungeon.durationSeconds)
                  : "00:00:00"}
              </span>
              <div className="row-action">
                {dungeon.status === "idle" && (
                  <button
                    type="button"
                    className="start-button"
                    disabled={isAnotherRunActive}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStart(dungeon.id);
                    }}
                  >
                    <Play size={15} weight="fill" />
                    Старт
                  </button>
                )}
                {dungeon.status === "completed" && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={isExpanded ? "Скрыть детали" : "Показать детали"}
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : dungeon.id)}
                  >
                    <CaretDown
                      size={16}
                      className={isExpanded ? "caret caret--open" : "caret"}
                    />
                  </button>
                )}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  className="dungeon-details"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Detail label="Время прохождения" value={formatDuration(dungeon.durationSeconds)} />
                  <Detail
                    label="Получили награду"
                    value={`${dungeon.rewardedSlots} / ${maxRewardedSlots}`}
                  />
                  <Detail label="Сундуки" value={dungeon.chests.toString()} />
                  {editingRewardId === dungeon.id ? (
                    <div className="reward-editor">
                      <div className="reward-slot-picker" aria-label="Получившие награду персонажи">
                        {Array.from({ length: maxRewardedSlots }, (_, index) => (
                          <button
                            type="button"
                            key={index}
                            className={rewardDraft.includes(index) ? "is-selected" : ""}
                            aria-pressed={rewardDraft.includes(index)}
                            onClick={() =>
                              setRewardDraft((current) =>
                                current.includes(index)
                                  ? current.filter((slot) => slot !== index)
                                  : [...current, index],
                              )
                            }
                          >
                            {maxRewardedSlots === 1 ? "Персонаж" : `Твин ${index + 1}`}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="primary-button primary-button--compact"
                        onClick={() => {
                          updateDungeonReward(pack.id, dungeon.id, rewardDraft);
                          setEditingRewardId(null);
                        }}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setEditingRewardId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <div className="dungeon-details__actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setRewardDraft(
                            dungeon.rewardedSlotIndexes ??
                              Array.from(
                                { length: dungeon.rewardedSlots },
                                (_, slot) => slot,
                              ),
                          );
                          setEditingRewardId(dungeon.id);
                        }}
                      >
                        Исправить награду
                      </button>
                      <button
                        type="button"
                        className="danger-ghost-button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Вернуть «${dungeon.name}» в состояние «Не начат» и убрать начисленные за это прохождение сундуки?`,
                            )
                          ) {
                            reopenDungeon(pack.id, dungeon.id);
                            setExpandedId(null);
                          }
                        }}
                      >
                        <ArrowCounterClockwise size={16} />
                        Отменить прохождение
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryView() {
  const history = useCastarynStore((state) => state.history);

  return (
    <>
      <PageHeading
        title="История"
        description="Подробные результаты завершённых PvE-дней."
      />
      <div className="history-list">
        {history.length === 0 && (
          <div className="history-empty">
            <Rows size={28} />
            <strong>История пока пуста</strong>
            <span>Завершённые прохождения появятся здесь после смены дня.</span>
          </div>
        )}
        {history.map((day) => (
          <article className="history-day" key={day.date}>
            <div className="history-day__heading">
              <div>
                <span>{day.date}</span>
                <strong>{day.label}</strong>
              </div>
              <div className="history-summary">
                <span>{day.dungeons} данжей</span>
                <span>{day.chests} сундуков</span>
                <span>{formatDuration(day.durationSeconds)}</span>
              </div>
            </div>
            <div className="history-packs">
              {day.packs.map((pack) => (
                <div className="history-pack" key={pack.name}>
                  <strong>{pack.name}</strong>
                  <div className="history-dungeons">
                    {pack.dungeons.map((dungeon) => (
                      <div className="history-dungeon" key={dungeon.id}>
                        <strong>{dungeon.name}</strong>
                        <span>{formatDuration(dungeon.durationSeconds)}</span>
                        <span>{dungeon.chests} сундуков</span>
                        <span>{dungeon.rewardedSlots} получили награду</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function IntegrationsView() {
  return <CreatorIntegrationsView />;
}

function SettingsView() {
  const profile = useCastarynStore((state) => state.profile);
  const playMode = useCastarynStore((state) => state.playMode);
  const defaultPacks = useCastarynStore((state) => state.defaultPacks);
  const todayPacks = useCastarynStore((state) => state.packs);
  const updateProfile = useCastarynStore((state) => state.updateProfile);
  const setDefaultPackCount = useCastarynStore(
    (state) => state.setDefaultPackCount,
  );
  const renameDefaultPack = useCastarynStore(
    (state) => state.renameDefaultPack,
  );
  const toggleDefaultDungeon = useCastarynStore(
    (state) => state.toggleDefaultDungeon,
  );
  const moveDefaultDungeon = useCastarynStore(
    (state) => state.moveDefaultDungeon,
  );
  const interfaceSettings = useCastarynStore(
    (state) => state.interfaceSettings,
  );
  const updateInterfaceSettings = useCastarynStore(
    (state) => state.updateInterfaceSettings,
  );
  const [name, setName] = useState(profile.name);
  const [server, setServer] = useState(profile.server);
  const [saved, setSaved] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [shortcutStatus, setShortcutStatus] = useState(
    isTauri() ? "Проверяем сочетания…" : "Доступно в Windows-приложении",
  );
  const lastDefaultPack = defaultPacks[defaultPacks.length - 1];
  const lastTodayPack = todayPacks.find(
    (pack) => pack.id === lastDefaultPack?.id,
  );
  const lastPackHasProtectedData =
    !!lastDefaultPack &&
    [lastDefaultPack, lastTodayPack]
      .filter((pack): pack is Pack => !!pack)
      .some(
        (pack) =>
          getPackChestTotal(pack) > 0 ||
          pack.completedManually ||
          pack.dungeons.some((dungeon) => dungeon.status !== "idle"),
      );

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (
        event as CustomEvent<{ status: string; message?: string }>
      ).detail;
      setShortcutStatus(
        detail.status === "ready"
          ? "Горячие клавиши активны"
          : detail.message ?? "Не удалось включить горячие клавиши",
      );
    };
    window.addEventListener(shortcutStatusEvent, handleStatus);
    return () =>
      window.removeEventListener(shortcutStatusEvent, handleStatus);
  }, []);

  async function applyWindowSize(width: number, height: number) {
    if (!isTauri()) {
      window.resizeTo(width, height);
      return;
    }
    const appWindow = getCurrentWindow();
    await appWindow.unmaximize();
    await appWindow.setSize(new LogicalSize(width, height));
    await appWindow.center();
  }

  async function runBackup(command: "export_backup" | "import_backup") {
    if (!isTauri()) {
      setBackupStatus("Экспорт и импорт доступны в Windows-приложении.");
      return;
    }
    if (
      command === "import_backup" &&
      !window.confirm(
        "Импорт полностью заменит текущий профиль, настройки и историю Castaryn. Продолжить?",
      )
    ) {
      return;
    }

    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const result = await invoke<string | null>(command);
      if (!result) {
        setBackupStatus("Действие отменено.");
        return;
      }
      if (command === "import_backup") {
        window.location.reload();
        return;
      }
      setBackupStatus("Резервная копия сохранена.");
    } catch (error) {
      setBackupStatus(
        typeof error === "string" ? error : "Не удалось выполнить операцию.",
      );
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Настройки"
        description="Профиль, локальные данные и параметры модулей."
      />
      <div className="settings-layout">
        <section className="settings-section">
          <div className="settings-section__heading">
            <UserCircle size={21} />
            <div>
              <h2>Профиль</h2>
              <p>Эти данные можно использовать в командах и оверлее.</p>
            </div>
          </div>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfile({ name: name.trim() || profile.name, server: server.trim() });
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1800);
            }}
          >
            <label>
              <span>Имя</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="settings-form__field">
              <span>Сервер</span>
              <AppSelect
                ariaLabel="Сервер Perfect World"
                value={server}
                onValueChange={setServer}
                options={[
                  { value: "", label: "Не выбран" },
                  ...(server && !isCurrentPerfectWorldServer(server)
                    ? [{ value: server, label: `${server} (сохранён ранее)` }]
                    : []),
                  ...perfectWorldServers.map((serverName) => ({
                    value: serverName,
                    label: serverName,
                  })),
                ]}
              />
            </div>
            <button type="submit" className="primary-button">
              <Check size={17} weight="bold" />
              {saved ? "Сохранено" : "Сохранить"}
            </button>
          </form>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <ListChecks size={21} />
            <div>
              <h2>Постоянный план</h2>
              <p>
                Этот набор пачек и данжей используется при создании каждого
                нового дня.
              </p>
            </div>
          </div>
          {playMode === "multi" && (
            <div className="pack-count-setting">
              <span>Количество пачек</span>
              <div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Уменьшить количество пачек"
                  disabled={
                    defaultPacks.length <= 1 || lastPackHasProtectedData
                  }
                  onClick={() => setDefaultPackCount(defaultPacks.length - 1)}
                >
                  <Minus size={16} />
                </button>
                <strong>{defaultPacks.length}</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Увеличить количество пачек"
                  disabled={defaultPacks.length >= 20}
                  onClick={() => setDefaultPackCount(defaultPacks.length + 1)}
                >
                  <Plus size={16} />
                </button>
              </div>
              {lastPackHasProtectedData && (
                <small>
                  Последнюю пачку нельзя удалить: в ней есть прогресс или сундуки.
                </small>
              )}
            </div>
          )}
          <div className="default-pack-settings">
            {defaultPacks.map((pack) => (
              <PackSettingsCard
                key={pack.id}
                pack={pack}
                allowRename={playMode === "multi"}
                onRename={(name) => renameDefaultPack(pack.id, name)}
                onToggleDungeon={(dungeonId) =>
                  toggleDefaultDungeon(pack.id, dungeonId)
                }
                onMoveDungeon={(dungeonId, direction) =>
                  moveDefaultDungeon(pack.id, dungeonId, direction)
                }
              />
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <Keyboard size={21} />
            <div>
              <h2>Управление фармом</h2>
              <p>
                Запускайте и завершайте маршрут, не переключаясь из игры.
              </p>
            </div>
          </div>
          <div className="automation-settings">
            <label>
              <span>Начать / завершить и перейти дальше</span>
              <AppSelect
                ariaLabel="Основная горячая клавиша"
                value={interfaceSettings.primaryShortcut}
                onValueChange={(primaryShortcut) =>
                  updateInterfaceSettings({ primaryShortcut })
                }
                options={[
                  { value: "Shift+F1", label: "Shift + F1" },
                  { value: "Shift+F", label: "Shift + F" },
                  { value: "Shift+G", label: "Shift + G" },
                  { value: "Control+F", label: "Ctrl + F" },
                  { value: "Control+Shift+F", label: "Ctrl + Shift + F" },
                  { value: "Alt+F", label: "Alt + F" },
                ]}
              />
            </label>
            <label>
              <span>Отменить последнее действие</span>
              <AppSelect
                ariaLabel="Горячая клавиша отмены"
                value={interfaceSettings.undoShortcut}
                onValueChange={(undoShortcut) =>
                  updateInterfaceSettings({ undoShortcut })
                }
                options={[
                  { value: "Shift+G", label: "Shift + G" },
                  { value: "Shift+H", label: "Shift + H" },
                  { value: "Control+G", label: "Ctrl + G" },
                  { value: "Control+Shift+G", label: "Ctrl + Shift + G" },
                  { value: "Alt+G", label: "Alt + G" },
                ]}
              />
            </label>
            <label className="display-toggle automation-settings__autostart">
              <span>
                <strong>Запускать вместе с Windows</strong>
                <small>
                  Выключено по умолчанию. При включении Castaryn запустится
                  после входа в Windows. Повышенные права запрашивает только
                  изолированный обработчик горячих клавиш.
                </small>
              </span>
              <input
                type="checkbox"
                checked={interfaceSettings.startWithWindows}
                onChange={(event) =>
                  updateInterfaceSettings({
                    startWithWindows: event.target.checked,
                  })
                }
              />
            </label>
          </div>
          <p className="settings-feedback" role="status">
            {shortcutStatus}
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <Monitor size={21} />
            <div>
              <h2>Интерфейс и окно</h2>
              <p>
                Настройте размер окна, масштаб элементов и визуальную плотность.
              </p>
            </div>
          </div>
          <div className="display-settings">
            <div className="display-setting">
              <div>
                <strong>Размер окна</strong>
                <span>WebView автоматически использует системный DPI.</span>
              </div>
              <div className="segmented-setting">
                {[
                  [1024, 720, "Компактное"],
                  [1280, 820, "Обычное"],
                  [1440, 900, "Большое"],
                ].map(([width, height, label]) => (
                  <button
                    type="button"
                    key={String(label)}
                    onClick={() =>
                      void applyWindowSize(Number(width), Number(height))
                    }
                  >
                    <strong>{label}</strong>
                    <span>
                      {width} × {height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="display-setting">
              <div>
                <strong>Масштаб интерфейса</strong>
                <span>Не зависит от масштабирования Windows.</span>
              </div>
              <div className="segmented-setting segmented-setting--small">
                {([90, 100, 110] as const).map((scale) => (
                  <button
                    type="button"
                    key={scale}
                    className={
                      interfaceSettings.scale === scale ? "is-active" : ""
                    }
                    onClick={() => updateInterfaceSettings({ scale })}
                  >
                    {scale}%
                  </button>
                ))}
              </div>
            </div>
            <label className="display-toggle">
              <span>
                <strong>Компактный режим</strong>
                <small>Уменьшает вертикальные отступы в рабочих экранах.</small>
              </span>
              <input
                type="checkbox"
                checked={interfaceSettings.compactMode}
                onChange={(event) =>
                  updateInterfaceSettings({
                    compactMode: event.target.checked,
                  })
                }
              />
            </label>
            <label className="display-toggle">
              <span>
                <strong>Уменьшить анимации</strong>
                <small>
                  Отключает переходы между разделами и лишнее движение.
                </small>
              </span>
              <input
                type="checkbox"
                checked={interfaceSettings.reduceMotion}
                onChange={(event) =>
                  updateInterfaceSettings({
                    reduceMotion: event.target.checked,
                  })
                }
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <Database size={21} />
            <div>
              <h2>Локальные данные</h2>
              <p>Создайте резервную копию профиля и всей истории.</p>
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={backupBusy}
              onClick={() => void runBackup("export_backup")}
            >
              <Copy size={17} />
              Экспортировать данные
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={backupBusy}
              onClick={() => void runBackup("import_backup")}
            >
              Импортировать копию
            </button>
          </div>
          {backupStatus && (
            <p className="settings-feedback" role="status">
              {backupStatus}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function PackSettingsCard({
  pack,
  allowRename,
  onRename,
  onToggleDungeon,
  onMoveDungeon,
}: {
  pack: Pack;
  allowRename: boolean;
  onRename: (name: string) => void;
  onToggleDungeon: (dungeonId: string) => void;
  onMoveDungeon: (
    dungeonId: string,
    direction: "up" | "down",
  ) => void;
}) {
  const [draft, setDraft] = useState(pack.name);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => setDraft(pack.name), [pack.name]);

  const featuredDungeons = dungeonCatalog.filter(([id]) =>
    featuredDungeonIds.includes(id as (typeof featuredDungeonIds)[number]),
  );
  const selectedExtras = dungeonCatalog.filter(
    ([id]) =>
      !featuredDungeonIds.includes(
        id as (typeof featuredDungeonIds)[number],
      ) && pack.dungeons.some((dungeon) => dungeon.id === id),
  );

  return (
    <div className="default-pack-card">
      <label className="pack-name-field">
        <span>Название</span>
        <input
          value={draft}
          disabled={!allowRename}
          maxLength={48}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <div className="pack-dungeon-heading">
        <div>
          <strong>Данжи</strong>
          <span>Основные доступны сразу. Остальные можно добавить из каталога.</span>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setCatalogOpen(true)}
        >
          <Plus size={16} />
          Добавить из каталога
        </button>
      </div>
      <div className="route-order-editor">
        <div className="route-order-editor__heading">
          <strong>Порядок прохождения</strong>
          <span>Горячая клавиша идёт по этому списку сверху вниз.</span>
        </div>
        <ol>
          {pack.dungeons.map((dungeon, index) => (
            <li key={dungeon.id}>
              <span className="route-order-editor__index">{index + 1}</span>
              <span>{dungeon.name}</span>
              <div>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === 0}
                  aria-label={`Поднять ${dungeon.name}`}
                  onClick={() => onMoveDungeon(dungeon.id, "up")}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === pack.dungeons.length - 1}
                  aria-label={`Опустить ${dungeon.name}`}
                  onClick={() => onMoveDungeon(dungeon.id, "down")}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="featured-dungeon-options">
        {featuredDungeons.map(([id, name, category]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={pack.dungeons.some((dungeon) => dungeon.id === id)}
              onChange={() => onToggleDungeon(id)}
            />
            <span>
              <strong>{name}</strong>
              <small>{category}</small>
            </span>
          </label>
        ))}
      </div>
      {selectedExtras.length > 0 && (
        <div className="selected-extra-dungeons">
          <span>Добавлены из каталога</span>
          <div>
            {selectedExtras.map(([id, name]) => (
              <button
                type="button"
                key={id}
                onClick={() => onToggleDungeon(id)}
                aria-label={`Убрать ${name}`}
              >
                {name}
                <X size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      {catalogOpen && (
        <div
          className="dialog-backdrop dungeon-picker-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCatalogOpen(false);
          }}
        >
          <section
            className="dungeon-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`dungeon-picker-${pack.id}`}
          >
            <header>
              <div>
                <h2 id={`dungeon-picker-${pack.id}`}>Каталог данжей</h2>
                <p>Выберите дополнительные активности для {pack.name}.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть каталог"
                onClick={() => setCatalogOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="default-dungeon-options">
              {dungeonCategories.map((category) => (
                <section className="default-dungeon-group" key={category}>
                  <strong>{category}</strong>
                  <div>
                    {dungeonCatalog
                      .filter(
                        ([id, , dungeonCategory]) =>
                          dungeonCategory === category &&
                          !featuredDungeonIds.includes(
                            id as (typeof featuredDungeonIds)[number],
                          ),
                      )
                      .map(([id, name]) => (
                        <label key={id}>
                          <input
                            type="checkbox"
                            checked={pack.dungeons.some(
                              (dungeon) => dungeon.id === id,
                            )}
                            onChange={() => onToggleDungeon(id)}
                          />
                          <span>{name}</span>
                        </label>
                      ))}
                  </div>
                </section>
              ))}
            </div>
            <footer>
              <span>{pack.dungeons.length} выбрано</span>
              <button
                type="button"
                className="primary-button"
                onClick={() => setCatalogOpen(false)}
              >
                Готово
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
