import {
  Broadcast,
  Check,
  Coins,
  CrownSimple,
  Lightning,
  LinkSimple,
  LockKey,
  PencilSimple,
  Plus,
  SignOut,
  Trash,
  TwitchLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type React from "react";
import {
  beginCreatorLogin,
  beginTwitchConnection,
  beginYoutubeConnection,
  deleteCommand,
  disconnectTwitch,
  disconnectYoutube,
  adjustEventBalance,
  fetchCreatorAccess,
  forgetOverlayToken,
  getEventsConfiguration,
  getTwitchConnection,
  getYoutubeConnection,
  listCommands,
  listCreatorWorkspaces,
  listEventBalances,
  loadCreatorRuntimeConfig,
  logoutCreator,
  previewCommand,
  restoreCreatorLogin,
  saveCommand,
  stopAllEventEffects,
  updateEventsProfile,
  updateEventConfiguration,
  type CommandInput,
  type CreatorAccessSnapshot,
  type CreatorRuntimeConfig,
  type CreatorWorkspace,
  type EventsConfiguration,
  type StreamingCommand,
  type TwitchConnection,
  type YoutubeConnection,
  type ViewerBalance,
} from "../lib/creator-client";
import { OverlayPanel } from "../components/OverlayPanel";
import { AppSelect } from "../components/AppSelect";
import { usePublicStreamState } from "../hooks/usePublicStreamState";

const emptyCommand: CommandInput = {
  provider: "twitch",
  trigger: "!",
  responseTemplate: "Сегодня: {progress}. Сундуки: {reward_total}",
  accessLevel: "everyone",
  enabled: true,
};

export function IntegrationsView() {
  const [runtime, setRuntime] = useState<CreatorRuntimeConfig | null>(null);
  const [access, setAccess] = useState<CreatorAccessSnapshot | null>(null);
  const [workspaces, setWorkspaces] = useState<CreatorWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<CreatorWorkspace | null>(null);
  const [connection, setConnection] = useState<TwitchConnection | null>(null);
  const [youtubeConnection, setYoutubeConnection] =
    useState<YoutubeConnection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  // Every early-exit path below (config not set up, session not restored,
  // an unexpected failure) must clear ALL creator-scoped state -- not just
  // `access` -- otherwise a previous session's Twitch/YouTube connection
  // identity can keep showing after logout, or briefly flash when a
  // different account signs in before the fresh fetches below resolve.
  const resetCreatorState = useCallback(() => {
    setAccess(null);
    setWorkspaces([]);
    setSelectedWorkspace(null);
    setConnection(null);
    setYoutubeConnection(null);
  }, []);

  const loadCreator = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const config = await loadCreatorRuntimeConfig();
      setRuntime(config);
      if (!config.configured) {
        resetCreatorState();
        return;
      }
      const restored = await restoreCreatorLogin();
      if (!restored) {
        resetCreatorState();
        return;
      }
      const [accessSnapshot, availableWorkspaces] = await Promise.all([
        fetchCreatorAccess(),
        listCreatorWorkspaces().catch(() => []),
      ]);
      setAccess(accessSnapshot);
      setWorkspaces(availableWorkspaces);
      const [ownConnection, ownYoutubeConnection] = await Promise.all([
        getTwitchConnection().catch(() => null),
        getYoutubeConnection().catch(() => null),
      ]);
      setConnection(ownConnection);
      setYoutubeConnection(ownYoutubeConnection);
      const preferred =
        availableWorkspaces.find(
          (workspace) =>
            workspace.creatorIdentityId ===
            accessSnapshot.creatorIdentityId,
        ) ??
        availableWorkspaces[0] ??
        null;
      setSelectedWorkspace(preferred);
    } catch {
      resetCreatorState();
    } finally {
      setBusy(false);
    }
  }, [resetCreatorState]);

  useEffect(() => {
    void loadCreator();
  }, [loadCreator]);

  async function login() {
    if (!runtime) return;
    setBusy(true);
    setError("");
    try {
      await beginCreatorLogin(runtime);
      await loadCreator();
    } catch {
      setError("Вход не завершён. Castaryn Player продолжает работать локально.");
      setBusy(false);
    }
  }

  async function connectTwitch() {
    setBusy(true);
    setError("");
    try {
      await beginTwitchConnection();
      setError(
        "Подтвердите доступ в браузере, затем нажмите «Проверить подключение».",
      );
    } catch {
      setError("Не удалось начать подключение Twitch.");
    } finally {
      setBusy(false);
    }
  }

  async function connectYoutube() {
    setBusy(true);
    setError("");
    try {
      await beginYoutubeConnection();
      setError(
        "Подтвердите доступ в браузере, затем нажмите «Проверить подключение».",
      );
    } catch {
      setError(
        "Не удалось начать подключение YouTube. Возможно, интеграция ещё не настроена на сервере.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkStreamingConnections() {
    setBusy(true);
    try {
      const [twitch, youtube] = await Promise.all([
        getTwitchConnection().catch(() => null),
        getYoutubeConnection().catch(() => null),
      ]);
      setConnection(twitch);
      setYoutubeConnection(youtube);
      if (!twitch && !youtube) {
        setError("Стриминговый канал ещё не подключён.");
        return;
      }
      setError("");
      await loadCreator();
    } finally {
      setBusy(false);
    }
  }

  const hasSession = access !== null || workspaces.length > 0;
  const creatorActive = access?.active === true;
  const workspace = selectedWorkspace;

  return (
    <>
      <header className="page-heading">
        <div>
          <span className="page-heading__kicker">Creator workspace</span>
          <h1>Стриминг</h1>
          <p>
            Twitch, OBS и будущие стриминговые интеграции работают через
            защищённый серверный слой.
          </p>
        </div>
        {hasSession && (
          <button
            className="secondary-button"
            onClick={() => {
              void logoutCreator(
                workspaces.map((item) => item.creatorIdentityId),
              ).then(loadCreator);
            }}
          >
            <SignOut /> Выйти
          </button>
        )}
      </header>

      {!runtime?.configured ? (
        <CreatorGate
          icon={<LockKey weight="fill" />}
          title="Creator будет доступен после настройки сервера"
          description="Локальный Castaryn Player полностью работает без авторизации. Creator не имитирует подключение без защищённой серверной конфигурации."
        />
      ) : !hasSession ? (
        <CreatorGate
          icon={<CrownSimple weight="fill" />}
          title="Войдите в Castaryn Account"
          description="Авторизация нужна только для стриминговых функций. Данные Player и история PvE не отправляются на сервер."
          action={
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void login()}
            >
              <LinkSimple /> Войти
            </button>
          }
        />
      ) : !creatorActive && workspaces.length === 0 ? (
        <CreatorGate
          icon={<Broadcast weight="fill" />}
          title={
            connection || youtubeConnection
              ? "Подтвердите роль модератора"
              : "Подключите стриминговый канал для проверки роли"
          }
          description={
            connection || youtubeConnection
              ? "Напишите любое сообщение в чате нужного канала с badge модератора, затем обновите доступ. Castaryn не использует приглашения или отдельные списки."
              : "Channel ID нужен, чтобы безопасно сопоставить ваш Castaryn Account с moderator badge в чате канала."
          }
          action={
            <div className="creator-gate__actions">
              {!connection && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void connectTwitch()}
                >
                  <TwitchLogo /> Подключить Twitch
                </button>
              )}
              {!youtubeConnection && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void connectYoutube()}
                >
                  <YoutubeLogo /> Подключить YouTube
                </button>
              )}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void checkStreamingConnections()}
              >
                Обновить доступ
              </button>
            </div>
          }
        />
      ) : (
        <>
          {workspaces.length > 1 && (
            <div className="workspace-switcher">
              <span>Рабочее пространство</span>
              <AppSelect
                ariaLabel="Рабочее пространство"
                value={workspace?.creatorIdentityId ?? ""}
                onValueChange={(value) => {
                  const next =
                    workspaces.find(
                      (item) =>
                        item.creatorIdentityId === value,
                    ) ?? null;
                  setSelectedWorkspace(next);
                  setConnection(null);
                  setYoutubeConnection(null);
                  if (next?.role === "owner") {
                    void getTwitchConnection()
                      .then(setConnection)
                      .catch(() => setConnection(null));
                    void getYoutubeConnection()
                      .then(setYoutubeConnection)
                      .catch(() => setYoutubeConnection(null));
                  }
                }}
                options={workspaces.map((item) => ({
                  value: item.creatorIdentityId,
                  label: `${item.channelName ?? "Creator"} · ${
                    item.role === "owner" ? "владелец" : "модератор"
                  }`,
                }))}
              />
            </div>
          )}

          {workspace?.role === "owner" && !connection && !youtubeConnection ? (
            <CreatorGate
              icon={<TwitchLogo weight="fill" />}
              title="Подключите стриминговый канал"
              description="Castaryn использует официальный OAuth и сохраняет Channel ID как основную привязку Creator. Достаточно подключить одну платформу — можно и обе."
              action={
                <div className="creator-gate__actions">
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void connectTwitch()}
                  >
                    <TwitchLogo /> Подключить Twitch
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void connectYoutube()}
                  >
                    <YoutubeLogo /> Подключить YouTube
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void checkStreamingConnections()}
                  >
                    Проверить подключение
                  </button>
                </div>
              }
            />
          ) : workspace ? (
            <CreatorWorkspacePanel
              connection={connection}
              youtubeConnection={youtubeConnection}
              workspace={workspace}
              onConnectTwitch={
                workspace.role === "owner" ? connectTwitch : undefined
              }
              onConnectYoutube={
                workspace.role === "owner" ? connectYoutube : undefined
              }
              onDisconnect={
                workspace.role === "owner" && connection
                  ? async () => {
                      await disconnectTwitch();
                      await forgetOverlayToken(
                        workspace.creatorIdentityId,
                      ).catch(() => undefined);
                      setConnection(null);
                      await loadCreator();
                    }
                  : undefined
              }
              onDisconnectYoutube={
                workspace.role === "owner" && youtubeConnection
                  ? async () => {
                      await disconnectYoutube();
                      await forgetOverlayToken(
                        workspace.creatorIdentityId,
                      ).catch(() => undefined);
                      setYoutubeConnection(null);
                      await loadCreator();
                    }
                  : undefined
              }
            />
          ) : null}
        </>
      )}

      {error && <div className="creator-message">{error}</div>}

      <article className="integration-card integration-card--roadmap">
        <div className="integration-card__top">
          <div className="integration-icon">
            <Broadcast size={25} weight="fill" />
          </div>
          <span className="integration-status">Roadmap</span>
        </div>
        <div>
          <h2>Будущие интеграции</h2>
          <p>
            Архитектура использует нейтральные streaming connections, поэтому
            новые платформы не меняют ядро Perfect World PvE.
          </p>
        </div>
        <div className="integration-roadmap">
          <span>Стриминговые платформы</span>
          <span>Чаты и боты</span>
          <span>Удалённое управление</span>
        </div>
      </article>
    </>
  );
}

function CreatorWorkspacePanel({
  workspace,
  connection,
  youtubeConnection,
  onConnectTwitch,
  onConnectYoutube,
  onDisconnect,
  onDisconnectYoutube,
}: {
  workspace: CreatorWorkspace;
  connection: TwitchConnection | null;
  youtubeConnection: YoutubeConnection | null;
  onConnectTwitch?: () => void;
  onConnectYoutube?: () => void;
  onDisconnect?: () => Promise<void>;
  onDisconnectYoutube?: () => Promise<void>;
}) {
  const [section, setSection] = useState<
    "commands" | "events" | "overlay"
  >(workspace.role === "moderator" ? "events" : "commands");

  useEffect(() => {
    setSection(workspace.role === "moderator" ? "events" : "commands");
  }, [workspace.creatorIdentityId, workspace.role]);

  return (
    <section className="creator-workspace">
      <div className="creator-workspace__heading">
        <div className="creator-channel">
          {workspace.provider === "youtube" ? (
            <YoutubeLogo weight="fill" />
          ) : workspace.provider === "twitch" ? (
            <TwitchLogo weight="fill" />
          ) : (
            <Broadcast weight="fill" />
          )}
          <div>
            <span>
              {workspace.role === "owner" ? "Ваш канал" : "Модератор"}
            </span>
            <strong>
              {(workspace.role === "owner"
                ? connection?.displayName ?? youtubeConnection?.displayName
                : null) ??
                workspace.channelName ??
                "Creator channel"}
            </strong>
          </div>
        </div>
        {workspace.role === "owner" && (
          <div className="creator-platforms">
            <div className="creator-platform-row">
              <TwitchLogo weight="fill" />
              <span>{connection ? connection.displayName : "Не подключено"}</span>
              {connection
                ? onDisconnect && (
                    <button
                      className="danger-button"
                      onClick={() => void onDisconnect()}
                    >
                      Отключить
                    </button>
                  )
                : onConnectTwitch && (
                    <button
                      className="secondary-button"
                      onClick={onConnectTwitch}
                    >
                      Подключить
                    </button>
                  )}
            </div>
            <div className="creator-platform-row">
              <YoutubeLogo weight="fill" />
              <span>
                {youtubeConnection ? youtubeConnection.displayName : "Не подключено"}
              </span>
              {youtubeConnection
                ? onDisconnectYoutube && (
                    <button
                      className="danger-button"
                      onClick={() => void onDisconnectYoutube()}
                    >
                      Отключить
                    </button>
                  )
                : onConnectYoutube && (
                    <button
                      className="secondary-button"
                      onClick={onConnectYoutube}
                    >
                      Подключить
                    </button>
                  )}
            </div>
          </div>
        )}
      </div>
      <nav className="creator-tabs">
        {workspace.role === "owner" && (
          <button
            className={section === "commands" ? "is-active" : ""}
            onClick={() => setSection("commands")}
          >
            Команды чата
          </button>
        )}
        <button
          className={section === "events" ? "is-active" : ""}
          onClick={() => setSection("events")}
        >
          Castaryn Events
        </button>
        {workspace.role === "owner" && (
          <>
            <button
              className={section === "overlay" ? "is-active" : ""}
              onClick={() => setSection("overlay")}
            >
              OBS Overlay
            </button>
          </>
        )}
      </nav>
      {section === "commands" && workspace.role === "owner" && (
        <CommandsPanel
          creatorId={workspace.creatorIdentityId}
          availableProviders={[
            ...(connection ? ["twitch" as const] : []),
            ...(youtubeConnection ? ["youtube" as const] : []),
          ]}
        />
      )}
      {section === "events" && (
        <EventsPanel
          creatorId={workspace.creatorIdentityId}
          role={workspace.role}
        />
      )}
      {section === "overlay" && workspace.role === "owner" && (
        <OverlayPanel creatorId={workspace.creatorIdentityId} />
      )}
    </section>
  );
}

function EventsPanel({
  creatorId,
  role,
}: {
  creatorId: string;
  role: CreatorWorkspace["role"];
}) {
  const [configuration, setConfiguration] =
    useState<EventsConfiguration | null>(null);
  const [balances, setBalances] = useState<ViewerBalance[]>([]);
  const [balancesCursor, setBalancesCursor] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [currencyName, setCurrencyName] = useState("");
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [togglingEvents, setTogglingEvents] = useState(false);
  const [viewer, setViewer] = useState("");
  const [amount, setAmount] = useState(1_000);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  const refreshBalances = () => {
    if (role !== "owner") return Promise.resolve();
    return listEventBalances(creatorId, query).then((page) => {
      setBalances(page.items);
      setBalancesCursor(page.nextCursor);
    });
  };

  const loadMoreBalances = () => {
    if (!balancesCursor) return Promise.resolve();
    return listEventBalances(creatorId, query, balancesCursor).then((page) => {
      setBalances((current) => [...current, ...page.items]);
      setBalancesCursor(page.nextCursor);
    });
  };

  useEffect(() => {
    let disposed = false;
    void getEventsConfiguration(creatorId)
      .then((value) => {
        if (disposed) return;
        setConfiguration(value);
        setProfileName(value.profile.name);
        setCurrencyName(value.profile.currencyName);
        setEventsEnabled(value.profile.isEnabled);
      })
      .catch(() => setMessage("Не удалось загрузить Castaryn Events."));
    if (role === "owner") {
      void listEventBalances(creatorId)
        .then((page) => {
          if (disposed) return;
          setBalances(page.items);
          setBalancesCursor(page.nextCursor);
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
    };
  }, [creatorId, role]);

  function isViewerQueryValid(value: string) {
    const trimmed = value.trim().replace(/^@/, "");
    return trimmed.length > 0 && trimmed.length <= 64;
  }

  async function changeBalance(direction: 1 | -1) {
    setMessage("");
    try {
      const updated = await adjustEventBalance(
        creatorId,
        viewer.trim().replace(/^@/, "").toLowerCase(),
        Math.abs(amount) * direction,
      );
      setMessage(
        `${updated.displayName}: ${updated.balance} ${currencyName}`,
      );
      await refreshBalances();
    } catch {
      setMessage("Баланс не изменён. Проверьте ник и доступный остаток.");
    }
  }

  if (!configuration) {
    return <div className="module-empty">Загружаем Castaryn Events…</div>;
  }

  return (
    <div className="events-module">
      <section className="events-profile-card">
        <div className="creator-module__title">
          <div>
            <strong>Castaryn Events</strong>
            <span>Один интерактивный профиль для канала</span>
          </div>
          <Lightning weight="fill" />
        </div>
        {role === "owner" ? (
          <div className="events-profile-form">
            <div className="events-master-control">
              <div>
                <strong>Events: {eventsEnabled ? "ON" : "OFF"}</strong>
                <span>
                  {eventsEnabled
                    ? "Команды событий доступны зрителям"
                    : "Покупки и запуск эффектов остановлены"}
                </span>
              </div>
              <label className="events-master-switch">
                <input
                  type="checkbox"
                  checked={eventsEnabled}
                  disabled={togglingEvents}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    // Roll back to what the switch showed a moment ago, not
                    // to configuration.profile.isEnabled -- that only
                    // updates once a request succeeds, so on a rapid second
                    // toggle it would still hold the value from before the
                    // first request even started. The `disabled` flag above
                    // additionally blocks a second toggle entirely while one
                    // is in flight, so this is defense in depth rather than
                    // the only thing preventing the race.
                    const previous = eventsEnabled;
                    setEventsEnabled(enabled);
                    setTogglingEvents(true);
                    setMessage("");
                    void updateEventsProfile(creatorId, {
                      name: profileName.trim() || configuration.profile.name,
                      currencyName:
                        currencyName.trim() ||
                        configuration.profile.currencyName,
                      enabled,
                    })
                      .then((profile) => {
                        setConfiguration((current) =>
                          current ? { ...current, profile } : current,
                        );
                        setMessage(
                          enabled
                            ? "Castaryn Events включены."
                            : "Castaryn Events выключены. Активные эффекты остановлены.",
                        );
                        if (!enabled) {
                          window.dispatchEvent(
                            new Event("castaryn-stop-all-effects"),
                          );
                        }
                      })
                      .catch(() => {
                        setEventsEnabled(previous);
                        setMessage("Не удалось изменить статус Castaryn Events.");
                      })
                      .finally(() => setTogglingEvents(false));
                  }}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            <label>
              <span>Название профиля</span>
              <input
                maxLength={80}
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
            <label>
              <span>Валюта канала</span>
              <input
                maxLength={32}
                value={currencyName}
                onChange={(event) => setCurrencyName(event.target.value)}
              />
            </label>
            <button
              className="primary-button"
              disabled={!profileName.trim() || !currencyName.trim()}
              onClick={() => {
                void updateEventsProfile(creatorId, {
                  name: profileName.trim(),
                  currencyName: currencyName.trim(),
                  enabled: eventsEnabled,
                })
                  .then((profile) => {
                    setConfiguration({ ...configuration, profile });
                    setMessage("Профиль Events сохранён.");
                  })
                  .catch(() => setMessage("Профиль не сохранён."));
              }}
            >
              <Check /> Сохранить
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                window.dispatchEvent(new Event("castaryn-stop-all-effects"));
                if (isTauri()) {
                  void invoke("cancel_system_effect");
                }
                void stopAllEventEffects(creatorId)
                  .then(() => setMessage("Все активные эффекты остановлены."))
                  .catch(() =>
                    setMessage(
                      "Локальный эффект остановлен, но серверную очередь очистить не удалось.",
                    ),
                  );
              }}
            >
              Остановить все эффекты
            </button>
          </div>
        ) : (
          <div className="events-profile-summary">
            <strong>{configuration.profile.name}</strong>
            <span>
              Events: {configuration.profile.isEnabled ? "ON" : "OFF"}
            </span>
            <span>
              Валюта:{" "}
              {configuration.profile.currencyName.toLocaleLowerCase("ru-RU")}
            </span>
          </div>
        )}
      </section>

      {role === "owner" && <section className="events-balance-card">
        <div className="creator-module__title">
          <div>
            <strong>Баланс зрителя</strong>
            <span>Доступно стримеру и модераторам</span>
          </div>
          <Coins weight="fill" />
        </div>
        <div className="events-balance-form">
          <input
            value={viewer}
            maxLength={64}
            placeholder="Ник зрителя"
            onChange={(event) => setViewer(event.target.value)}
          />
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          <button
            className="primary-button"
            disabled={!isViewerQueryValid(viewer)}
            onClick={() => void changeBalance(1)}
          >
            <Plus /> Начислить
          </button>
          <button
            className="secondary-button"
            disabled={!isViewerQueryValid(viewer)}
            onClick={() => void changeBalance(-1)}
          >
            Списать
          </button>
        </div>
        <div className="events-balance-search">
          <input
            value={query}
            maxLength={64}
            placeholder="Поиск по зрителям"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="secondary-button"
            onClick={() => void refreshBalances()}
          >
            Найти
          </button>
        </div>
        <div className="events-balances">
          {balances.map((balance) => (
            <div key={balance.viewerKey}>
              <strong>{balance.displayName}</strong>
              <span>
                {balance.balance}{" "}
                {configuration.profile.currencyName.toLocaleLowerCase("ru-RU")}
              </span>
            </div>
          ))}
        </div>
        {balancesCursor && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadMoreBalances()}
          >
            Показать ещё
          </button>
        )}
        {message && <span className="module-message">{message}</span>}
      </section>}

      <section className="events-catalog-card">
        <div className="creator-module__title">
          <div>
            <strong>События</strong>
            <span>Стоимость и длительность зафиксированы для MVP</span>
          </div>
        </div>
        <div className="events-catalog">
          {configuration.events.map((eventDefinition) => (
            <article key={eventDefinition.id}>
              <div className="event-config-fields">
                <input
                  aria-label={`Название ${eventDefinition.effectType}`}
                  value={eventDefinition.name}
                  maxLength={40}
                  onChange={(changeEvent) =>
                    setConfiguration({
                      ...configuration,
                      events: configuration.events.map((candidate) =>
                        candidate.id === eventDefinition.id
                          ? { ...candidate, name: changeEvent.target.value }
                          : candidate,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Команда ${eventDefinition.effectType}`}
                  value={eventDefinition.command}
                  maxLength={32}
                  onChange={(changeEvent) =>
                    setConfiguration({
                      ...configuration,
                      events: configuration.events.map((candidate) =>
                        candidate.id === eventDefinition.id
                          ? {
                              ...candidate,
                              command: changeEvent.target.value.toLowerCase(),
                            }
                          : candidate,
                      ),
                    })
                  }
                />
                <small>{eventDefinition.effectType}</small>
              </div>
              <span>
                {eventDefinition.price}{" "}
                {configuration.profile.currencyName.toLocaleLowerCase("ru-RU")}
              </span>
              <small>
                {eventDefinition.type === "timed"
                  ? `${eventDefinition.durationSeconds} сек.`
                  : "Мгновенное"}
              </small>
              <label className="event-config-toggle">
                <input
                  type="checkbox"
                  checked={eventDefinition.enabled}
                  onChange={(changeEvent) =>
                    setConfiguration({
                      ...configuration,
                      events: configuration.events.map((candidate) =>
                        candidate.id === eventDefinition.id
                          ? { ...candidate, enabled: changeEvent.target.checked }
                          : candidate,
                      ),
                    })
                  }
                />
                Активно
              </label>
              <label className="event-config-toggle">
                <input
                  type="checkbox"
                  checked={eventDefinition.showInCatalog}
                  onChange={(changeEvent) =>
                    setConfiguration({
                      ...configuration,
                      events: configuration.events.map((candidate) =>
                        candidate.id === eventDefinition.id
                          ? {
                              ...candidate,
                              showInCatalog: changeEvent.target.checked,
                            }
                          : candidate,
                      ),
                    })
                  }
                />
                Показывать в !ивенты
              </label>
              <button
                className="secondary-button"
                onClick={() => {
                  setMessage("");
                  void updateEventConfiguration(
                    creatorId,
                    eventDefinition.id,
                    {
                      name: eventDefinition.name,
                      command: eventDefinition.command,
                      enabled: eventDefinition.enabled,
                      showInCatalog: eventDefinition.showInCatalog,
                    },
                  )
                    .then((updated) => {
                      setConfiguration({
                        ...configuration,
                        events: configuration.events.map((candidate) =>
                          candidate.id === updated.id ? updated : candidate,
                        ),
                      });
                      setMessage("Конфигурация события сохранена.");
                    })
                    .catch(() =>
                      setMessage(
                        "Не удалось сохранить: проверьте название и уникальность команды.",
                      ),
                    );
                }}
              >
                Сохранить
              </button>
            </article>
          ))}
        </div>
        <p className="events-catalog-help">
          Баллы начисляют стример или модераторы. Зритель проверяет баланс
          командой <code>!баланс</code>. Полный каталог открывается командой{" "}
          <code>!ивенты</code>.
        </p>
      </section>
    </div>
  );
}

function CommandsPanel({
  creatorId,
  availableProviders,
}: {
  creatorId: string;
  availableProviders: Array<"twitch" | "youtube">;
}) {
  const streamState = usePublicStreamState();
  const [commands, setCommands] = useState<StreamingCommand[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommandInput>({
    ...emptyCommand,
    provider: availableProviders[0] ?? "twitch",
  });
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      listCommands(creatorId).then(setCommands).catch(() => {
        setError("Не удалось загрузить команды.");
      }),
    [creatorId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void previewCommand(
        creatorId,
        draft.responseTemplate,
        streamState,
      )
        .then(setPreview)
        .catch(() => setPreview("Проверьте переменные в ответе."));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [creatorId, draft.responseTemplate, streamState]);

  function edit(command: StreamingCommand) {
    setEditingId(command.id);
    setDraft({
      provider: command.provider,
      trigger: command.trigger,
      responseTemplate: command.responseTemplate,
      accessLevel: command.accessLevel,
      enabled: command.enabled,
    });
  }

  return (
    <div className="creator-module creator-module--commands">
      <div className="command-list">
        <div className="creator-module__title">
          <div>
            <strong>Команды</strong>
            <span>{commands.length} создано</span>
          </div>
          <button
            className="icon-action"
            aria-label="Новая команда"
            onClick={() => {
              setEditingId(null);
              setDraft({
                ...emptyCommand,
                provider: availableProviders[0] ?? "twitch",
              });
            }}
          >
            <Plus />
          </button>
        </div>
        {commands.map((command) => (
          <button
            className={
              editingId === command.id
                ? "command-row command-row--active"
                : "command-row"
            }
            key={command.id}
            onClick={() => edit(command)}
          >
            <span>
              <strong>{command.trigger}</strong>
              <small>
                {command.provider === "youtube" ? "YouTube" : "Twitch"} ·{" "}
                {command.responseTemplate}
              </small>
            </span>
            <PencilSimple />
          </button>
        ))}
        {commands.length === 0 && (
          <div className="module-empty">Создайте первую команду.</div>
        )}
      </div>

      <div className="command-editor">
        <div className="creator-module__title">
          <div>
            <strong>{editingId ? "Редактирование" : "Новая команда"}</strong>
            <span>Изменения применяются сразу</span>
          </div>
        </div>
        <div className="creator-form-grid">
          <div className="creator-form-field">
            <span>Платформа</span>
            <AppSelect
              ariaLabel="Платформа команды"
              value={draft.provider ?? availableProviders[0] ?? "twitch"}
              disabled={editingId !== null}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  provider: value as "twitch" | "youtube",
                })
              }
              options={[
                ...(availableProviders.includes("twitch")
                  ? [{ value: "twitch", label: "Twitch" }]
                  : []),
                ...(availableProviders.includes("youtube")
                  ? [{ value: "youtube", label: "YouTube" }]
                  : []),
              ]}
            />
          </div>
          <label>
            <span>Команда</span>
            <input
              value={draft.trigger}
              maxLength={32}
              onChange={(event) =>
                setDraft({ ...draft, trigger: event.target.value })
              }
            />
          </label>
          <div className="creator-form-field">
            <span>Доступ</span>
            <AppSelect
              ariaLabel="Доступ к команде"
              value={draft.accessLevel}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  accessLevel: value as CommandInput["accessLevel"],
                })
              }
              options={[
                { value: "everyone", label: "Все зрители" },
                { value: "moderators", label: "Модераторы" },
                { value: "creator", label: "Только стример" },
              ]}
            />
          </div>
          <label className="creator-form-grid__wide">
            <span>Ответ</span>
            <textarea
              value={draft.responseTemplate}
              maxLength={450}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  responseTemplate: event.target.value,
                })
              }
            />
          </label>
        </div>
        <div className="variable-strip">
          {[
            "{activity}",
            "{progress}",
            "{reward_total}",
            "{time}",
            "{server}",
            "{player}",
          ].map((variable) => (
            <button
              key={variable}
              onClick={() =>
                setDraft({
                  ...draft,
                  responseTemplate: `${draft.responseTemplate} ${variable}`,
                })
              }
            >
              {variable}
            </button>
          ))}
        </div>
        <div className="live-preview">
          <span>Предпросмотр</span>
          <p>{preview}</p>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="editor-actions">
          <button
            className="primary-button"
            disabled={
              !/^![\p{L}\p{N}_]{1,31}$/u.test(draft.trigger) ||
              !draft.responseTemplate.trim()
            }
            onClick={() => {
              setError("");
              void saveCommand(creatorId, draft, editingId ?? undefined)
                .then((saved) => {
                  setEditingId(saved.id);
                  return refresh();
                })
                .catch(() => setError("Команда не сохранена."));
            }}
          >
            <Check /> Сохранить
          </button>
          {editingId && (
            <button
              className="danger-button"
              onClick={() => {
                if (!window.confirm("Удалить эту команду на сервере?")) return;
                void deleteCommand(creatorId, editingId).then(() => {
                  setEditingId(null);
                  setDraft({
                    ...emptyCommand,
                    provider: availableProviders[0] ?? "twitch",
                  });
                  return refresh();
                });
              }}
            >
              <Trash /> Удалить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreatorGate({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="creator-gate">
      <div className="creator-gate__icon">{icon}</div>
      <div className="creator-gate__copy">
        <span>Castaryn Player активен</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}
