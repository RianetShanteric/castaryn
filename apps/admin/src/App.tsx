import {
  ArrowClockwise,
  Broadcast,
  CheckCircle,
  CrownSimple,
  MagnifyingGlass,
  Power,
  ShieldCheck,
  SignOut,
  TwitchLogo,
  UserCircle,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User, UserManager } from "oidc-client-ts";
import {
  AdminApi,
  type AdminCreatorRecord,
  type TwitchBotStatus,
  type YoutubeBotStatus,
} from "./api";
import {
  createAdminUserManager,
  isUsableAdminSession,
  readRuntimeConfig,
} from "./auth";

type Plan = "trial" | "monthly" | "yearly" | "lifetime";

export function App() {
  const runtimeResult = useMemo(() => {
    try {
      return { config: readRuntimeConfig(), error: false };
    } catch {
      return { config: null, error: true };
    }
  }, []);
  const runtime = runtimeResult.config;
  const manager = useMemo(
    () => (runtime ? createAdminUserManager(runtime) : null),
    [runtime],
  );
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false);

  useEffect(() => {
    if (!manager) {
      setLoadingSession(false);
      return;
    }
    void restoreSession(manager).then((session) => {
      setUser(session);
      setLoadingSession(false);
    });
  }, [manager]);

  // automaticSilentRenew is intentionally off (this is a short-lived admin
  // session, not one we want to keep alive indefinitely) but oidc-client-ts
  // still tracks expiry on its own timer either way. Without listening for
  // these events the UI never learns the token died until the next API call
  // fails with a generic error -- so mirror that state into `user` directly
  // and offer a clear way back in instead.
  useEffect(() => {
    if (!manager) return;
    const handleExpiring = () => setSessionExpiringSoon(true);
    const handleExpiredOrSignedOut = () => {
      setSessionExpiringSoon(false);
      setUser(null);
    };
    const handleLoaded = (loadedUser: User) => {
      setSessionExpiringSoon(false);
      setUser(loadedUser);
    };
    manager.events.addAccessTokenExpiring(handleExpiring);
    manager.events.addAccessTokenExpired(handleExpiredOrSignedOut);
    manager.events.addUserSignedOut(handleExpiredOrSignedOut);
    manager.events.addUserUnloaded(handleExpiredOrSignedOut);
    manager.events.addUserLoaded(handleLoaded);
    return () => {
      manager.events.removeAccessTokenExpiring(handleExpiring);
      manager.events.removeAccessTokenExpired(handleExpiredOrSignedOut);
      manager.events.removeUserSignedOut(handleExpiredOrSignedOut);
      manager.events.removeUserUnloaded(handleExpiredOrSignedOut);
      manager.events.removeUserLoaded(handleLoaded);
    };
  }, [manager]);

  if (runtimeResult.error || !runtime || !manager) {
    return (
      <CenteredState
        icon={<ShieldCheck />}
        title="Панель не настроена"
        description="Для запуска требуется защищённая конфигурация администратора."
      />
    );
  }
  if (loadingSession) {
    return (
      <CenteredState
        icon={<ArrowClockwise className="spin" />}
        title="Проверяем доступ"
        description="Подтверждаем отдельную административную сессию."
      />
    );
  }
  if (!isUsableAdminSession(user)) {
    return (
      <CenteredState
        icon={<ShieldCheck />}
        title="Castaryn Control"
        description="Доступ разрешён только владельцу проекта через отдельную учётную запись."
        action={
          <button
            className="button button--accent"
            onClick={() => void manager.signinRedirect()}
          >
            Войти безопасно
          </button>
        }
      />
    );
  }

  return (
    <AdminWorkspace
      apiUrl={runtime.apiUrl}
      manager={manager}
      user={user}
      sessionExpiringSoon={sessionExpiringSoon}
    />
  );
}

function AdminWorkspace({
  apiUrl,
  manager,
  user,
  sessionExpiringSoon,
}: {
  apiUrl: string;
  manager: UserManager;
  user: User;
  sessionExpiringSoon: boolean;
}) {
  const api = useMemo(
    () =>
      new AdminApi(apiUrl, async () => {
        const current = await manager.getUser();
        if (!isUsableAdminSession(current)) {
          throw new Error("Administrator session expired");
        }
        return current.access_token;
      }),
    [apiUrl, manager],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminCreatorRecord[]>([]);
  const [selected, setSelected] = useState<AdminCreatorRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    const updated = await api.getUser(selected.userId);
    setSelected(updated);
    setResults((current) =>
      current.map((record) =>
        record.userId === updated.userId ? updated : record,
      ),
    );
  }, [api, selected]);

  async function runSearch() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const records = await api.search(query.trim());
      setResults(records);
      if (records.length === 1) setSelected(records[0]!);
    } catch {
      setError("Поиск не выполнен. Проверьте соединение и права доступа.");
    } finally {
      setBusy(false);
    }
  }

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshSelected();
    } catch {
      setError("Изменение не применено. Состояние осталось прежним.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-shell">
      {sessionExpiringSoon && (
        <div className="session-warning" role="alert">
          <span>
            Сессия скоро истечёт. Сохраните изменения и войдите заново.
          </span>
          <button
            className="button button--accent"
            onClick={() => void manager.signinRedirect()}
          >
            Войти заново
          </button>
        </div>
      )}
      <header className="topbar">
        <div className="wordmark">
          <span>E</span>
          <div>
            <strong>Castaryn Control</strong>
            <small>Creator access</small>
          </div>
        </div>
        <div className="admin-identity">
          <ShieldCheck weight="fill" />
          <span>{user.profile.email ?? user.profile.sub}</span>
          <button
            aria-label="Выйти"
            className="icon-button"
            onClick={() => void manager.signoutRedirect()}
          >
            <SignOut />
          </button>
        </div>
      </header>

      <main>
        <TwitchBotCard api={api} />
        <YoutubeBotCard api={api} />
        <section className="search-panel">
          <div>
            <span className="eyebrow">Creator directory</span>
            <h1>Управление доступом</h1>
            <p>
              Поиск по Castaryn email, названию стримингового канала или Channel ID.
            </p>
          </div>
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <MagnifyingGlass />
            <input
              aria-label="Поиск пользователя"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="creator@example.com или Channel ID"
            />
            <button
              className="button button--accent"
              disabled={busy || query.trim().length < 2}
            >
              Найти
            </button>
          </form>
          {error && <div className="error-message">{error}</div>}
        </section>

        <div className="content-grid">
          <section className="results-panel">
            <div className="panel-title">
              <span>Результаты</span>
              <small>{results.length}</small>
            </div>
            {results.length === 0 ? (
              <EmptyResults />
            ) : (
              <div className="result-list">
                {results.map((record) => (
                  <button
                    className={
                      record.userId === selected?.userId
                        ? "result-row result-row--active"
                        : "result-row"
                    }
                    key={record.userId}
                    onClick={() => setSelected(record)}
                  >
                    <UserCircle />
                    <span>
                      <strong>
                        {record.streamingChannelName ?? record.email}
                      </strong>
                      <small>{record.email}</small>
                    </span>
                    <StatusDot active={record.subscription?.status === "active"} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="detail-panel">
            {selected ? (
              <CreatorCard
                key={selected.userId}
                busy={busy}
                record={selected}
                onGrant={(source, reason) =>
                  mutate(() =>
                    api.grantLifetime(
                      selected.userId,
                      source,
                      reason,
                    ),
                  )
                }
                onPlan={(plan, reason) =>
                  selected.subscription
                    ? mutate(() =>
                        api.changePlan(
                          selected.subscription!.id,
                          plan,
                          reason,
                        ),
                      )
                    : Promise.resolve()
                }
                onCancel={(reason) =>
                  selected.subscription
                    ? mutate(() =>
                        api.cancel(selected.subscription!.id, reason),
                      )
                    : Promise.resolve()
                }
              />
            ) : (
              <div className="detail-empty">
                <CrownSimple />
                <strong>Выберите Creator</strong>
                <span>Здесь появятся канал и текущий статус доступа.</span>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function TwitchBotCard({ api }: { api: AdminApi }) {
  const [status, setStatus] = useState<TwitchBotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setError("");
    return api
      .getTwitchBotStatus()
      .then(setStatus)
      .catch(() => setError("Не удалось проверить Castaryn Bot."));
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function authorize() {
    setBusy(true);
    setError("");
    try {
      const result = await api.authorizeTwitchBot();
      window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Не удалось начать авторизацию Twitch Bot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bot-status-panel">
      <div>
        <span className="eyebrow">Streaming infrastructure</span>
        <h2>Castaryn Twitch Bot</h2>
        <p>
          {status?.connected
            ? `Bot user ${status.externalUserId} авторизован.`
            : "Для команд необходим отдельный bot grant."}
        </p>
        {error && <small className="error-message">{error}</small>}
      </div>
      <div className="bot-status-actions">
        <StatusDot active={status?.connected === true} />
        <button
          className="button button--accent"
          disabled={busy}
          onClick={() => void authorize()}
        >
          {status?.connected ? "Переподключить" : "Авторизовать"}
        </button>
        <button
          className="icon-button"
          aria-label="Обновить статус бота"
          onClick={() => void refresh()}
        >
          <ArrowClockwise />
        </button>
      </div>
    </section>
  );
}

function YoutubeBotCard({ api }: { api: AdminApi }) {
  const [status, setStatus] = useState<YoutubeBotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setError("");
    return api
      .getYoutubeBotStatus()
      .then(setStatus)
      .catch(() => setError("Не удалось проверить Castaryn Bot."));
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function authorize() {
    setBusy(true);
    setError("");
    try {
      const result = await api.authorizeYoutubeBot();
      window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Не удалось начать авторизацию YouTube Bot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bot-status-panel">
      <div>
        <span className="eyebrow">Streaming infrastructure</span>
        <h2>Castaryn YouTube Bot</h2>
        <p>
          {status && !status.configured
            ? "Интеграция YouTube пока не настроена на сервере."
            : status?.connected
            ? `Bot channel ${status.externalUserId} авторизован.`
            : "Для команд необходим отдельный bot grant."}
        </p>
        {error && <small className="error-message">{error}</small>}
      </div>
      <div className="bot-status-actions">
        <StatusDot active={status?.connected === true} />
        <button
          className="button button--accent"
          disabled={busy || status?.configured === false}
          onClick={() => void authorize()}
        >
          {status?.configured === false
            ? "Не настроено"
            : status?.connected
              ? "Переподключить"
              : "Авторизовать"}
        </button>
        <button
          className="icon-button"
          aria-label="Обновить статус бота"
          onClick={() => void refresh()}
        >
          <ArrowClockwise />
        </button>
      </div>
    </section>
  );
}

function CreatorCard({
  record,
  busy,
  onGrant,
  onPlan,
  onCancel,
}: {
  record: AdminCreatorRecord;
  busy: boolean;
  onGrant: (
    source: "developer_grant" | "gift",
    reason: string,
  ) => Promise<unknown>;
  onPlan: (plan: Plan, reason: string) => Promise<unknown>;
  onCancel: (reason: string) => Promise<unknown>;
}) {
  const [plan, setPlan] = useState<Plan>(
    record.subscription?.plan ?? "lifetime",
  );
  const [source, setSource] = useState<"developer_grant" | "gift">(
    "developer_grant",
  );
  const [reason, setReason] = useState("Manual Creator access");

  return (
    <div className="creator-card">
      <div className="creator-card__heading">
        <div className="channel-mark">
          {record.streamingProvider === "youtube" ? (
            <YoutubeLogo weight="fill" />
          ) : record.streamingProvider === "twitch" ? (
            <TwitchLogo weight="fill" />
          ) : (
            <Broadcast weight="fill" />
          )}
        </div>
        <div>
          <span className="eyebrow">
            {record.streamingProvider ?? "Streaming"} channel
          </span>
          <h2>{record.streamingChannelName ?? "Канал не подключён"}</h2>
          <p>{record.streamingChannelId ?? "Channel ID отсутствует"}</p>
        </div>
        <StatusBadge status={record.subscription?.status ?? "none"} />
      </div>

      <dl className="identity-grid">
        <div>
          <dt>Castaryn Account</dt>
          <dd>{record.email}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{record.subscription?.plan ?? "Нет доступа"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{record.subscription?.source ?? "Не указан"}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {record.subscription?.expiresAt
              ? record.subscription.expiresAt.toLocaleDateString("ru-RU")
              : record.subscription?.plan === "lifetime"
                ? "Never"
                : "Не указано"}
          </dd>
        </div>
      </dl>

      <div className="control-form">
        <label>
          <span>Тип доступа</span>
          <select
            value={plan}
            onChange={(event) => setPlan(event.target.value as Plan)}
          >
            <option value="trial">Trial</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </label>
        {!record.subscription && (
          <label>
            <span>Источник</span>
            <select
              value={source}
              onChange={(event) =>
                setSource(
                  event.target.value as "developer_grant" | "gift",
                )
              }
            >
              <option value="developer_grant">Developer Grant</option>
              <option value="gift">Gift</option>
            </select>
          </label>
        )}
        <label className="reason-field">
          <span>Причина изменения</span>
          <input
            value={reason}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>

      <div className="creator-actions">
        {record.subscription ? (
          <>
            <button
              className="button button--accent"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void onPlan(plan, reason.trim())}
            >
              <CheckCircle /> Сохранить
            </button>
            <button
              className="button button--danger"
              disabled={
                busy ||
                record.subscription.status === "cancelled" ||
                reason.trim().length < 3
              }
              onClick={() => void onCancel(reason.trim())}
            >
              <Power /> Отключить
            </button>
          </>
        ) : (
          <button
            className="button button--accent"
            disabled={
              busy ||
              plan !== "lifetime" ||
              reason.trim().length < 3
            }
            onClick={() => void onGrant(source, reason.trim())}
          >
            <CrownSimple weight="fill" /> Активировать Lifetime
          </button>
        )}
      </div>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <i className={active ? "status-dot status-dot--active" : "status-dot"} />;
}

function StatusBadge({
  status,
}: {
  status: "active" | "expired" | "cancelled" | "none";
}) {
  const labels = {
    active: "ACTIVE",
    expired: "EXPIRED",
    cancelled: "DISABLED",
    none: "NO ACCESS",
  };
  return (
    <span className={`status-badge status-badge--${status}`}>
      {labels[status]}
    </span>
  );
}

function EmptyResults() {
  return (
    <div className="results-empty">
      <MagnifyingGlass />
      <span>Начните с поиска Creator-аккаунта.</span>
    </div>
  );
}

function CenteredState({
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
    <main className="centered-state">
      <div className="centered-state__icon">{icon}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {action}
    </main>
  );
}

async function restoreSession(manager: UserManager) {
  if (window.location.search.includes("code=")) {
    const user = await manager.signinRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
    return user;
  }
  return manager.getUser();
}
