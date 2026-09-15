import "@fontsource-variable/geist";
import "@radix-ui/themes/styles.css";
import {
  ArrowClockwise,
  Broadcast,
  CheckCircle,
  CloudCheck,
  Database,
  GlobeHemisphereWest,
  HardDrives,
  Pulse,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";
import { Theme } from "@radix-ui/themes";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadSnapshot,
  type OperationsSnapshot,
} from "./api";
import "./styles.css";

export function App() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const telegram = window.Telegram?.WebApp;
  const previewEnabled =
    (window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost") &&
    new URLSearchParams(window.location.search).has("preview");
  const initData = previewEnabled ? "__preview__" : telegram?.initData ?? "";

  const refresh = useCallback(async () => {
    if (!initData) {
      setError("Откройте Castaryn Control из меню Telegram-бота.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSnapshot(await loadSnapshot(initData));
      setError(null);
      telegram?.HapticFeedback?.impactOccurred("light");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось загрузить данные.",
      );
    } finally {
      setLoading(false);
    }
  }, [initData, telegram]);

  useEffect(() => {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor("#090d10");
    telegram?.setBackgroundColor("#090d10");
    void refresh();
  }, [refresh, telegram]);

  return (
    <main className="control-shell">
      <header className="control-header">
        <div className="brand-lockup">
          <img src="/tg/castaryn-icon.png" alt="" width="38" height="38" />
          <div>
            <strong>Castaryn Control</strong>
            <span>Закрытая панель владельца</span>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Обновить данные"
        >
          <ArrowClockwise size={20} className={loading ? "is-spinning" : ""} />
        </button>
      </header>

      {error ? (
        <section className="state-panel state-panel--error" role="alert">
          <WarningCircle size={28} />
          <div>
            <strong>Нет доступа к панели</strong>
            <p>{error}</p>
          </div>
        </section>
      ) : loading && !snapshot ? (
        <LoadingState />
      ) : snapshot ? (
        <Dashboard snapshot={snapshot} />
      ) : null}
    </main>
  );
}

export function Dashboard({ snapshot }: { snapshot: OperationsSnapshot }) {
  const healthy =
    snapshot.site.online && snapshot.system.eventWorkerOnline;
  return (
    <>
      <section className="status-hero">
        <div>
          <span className="eyebrow">СОСТОЯНИЕ СИСТЕМЫ</span>
          <h1>{healthy ? "Всё работает штатно" : "Требуется внимание"}</h1>
          <p>
            Обновлено{" "}
            {snapshot.generatedAt.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        {healthy ? (
          <CheckCircle size={36} weight="fill" />
        ) : (
          <WarningCircle size={36} weight="fill" />
        )}
      </section>

      <section className="metric-grid" aria-label="Ключевые показатели">
        <Metric
          icon={<GlobeHemisphereWest size={20} />}
          label="Посетители сегодня"
          value={snapshot.site.uniqueToday}
          detail={`${snapshot.site.viewsToday} просмотров`}
        />
        <Metric
          icon={<Users size={20} />}
          label="Аккаунты"
          value={snapshot.accounts.total}
          detail={`+${snapshot.accounts.today} сегодня`}
        />
        <Metric
          icon={<Broadcast size={20} />}
          label="Creator активны"
          value={snapshot.creators.active}
          detail={`${snapshot.creators.inactive} неактивны`}
        />
        <Metric
          icon={<Pulse size={20} />}
          label="Ответ сайта"
          value={
            snapshot.site.responseMs === null
              ? "Нет связи"
              : `${snapshot.site.responseMs} мс`
          }
          detail={snapshot.site.online ? "Онлайн" : "Недоступен"}
          tone={snapshot.site.online ? "positive" : "danger"}
        />
      </section>

      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ТРАФИК</span>
            <h2>Сайт</h2>
          </div>
          <CloudCheck size={24} />
        </div>
        <div className="period-grid">
          <Period label="Сегодня" views={snapshot.site.viewsToday} unique={snapshot.site.uniqueToday} />
          <Period label="7 дней" views={snapshot.site.views7Days} unique={snapshot.site.unique7Days} />
          <Period label="30 дней" views={snapshot.site.views30Days} unique={snapshot.site.unique30Days} />
        </div>
      </section>

      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ПЛАТФОРМЫ</span>
            <h2>Интеграции</h2>
          </div>
          <Broadcast size={24} />
        </div>
        <div className="integration-list">
          {snapshot.integrations.length ? (
            snapshot.integrations.map((integration) => (
              <div className="integration-row" key={integration.provider}>
                <div>
                  <strong>{providerName(integration.provider)}</strong>
                  <span>{integration.connected} каналов подключено</span>
                </div>
                <span
                  className={
                    integration.failed > 0
                      ? "status-tag status-tag--danger"
                      : "status-tag"
                  }
                >
                  {integration.failed > 0
                    ? `${integration.failed} ошибок`
                    : integration.botAuthorized
                      ? "Бот готов"
                      : "Без bot grant"}
                </span>
              </div>
            ))
          ) : (
            <p className="empty-copy">Подключённых платформ пока нет.</p>
          )}
        </div>
      </section>

      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ИНФРАСТРУКТУРА</span>
            <h2>Ресурсы</h2>
          </div>
          <Database size={24} />
        </div>
        <Resource
          icon={<HardDrives size={18} />}
          label="Диск"
          value={snapshot.system.diskUsedPercent}
        />
        <Resource
          icon={<Database size={18} />}
          label="Память"
          value={snapshot.system.memoryUsedPercent}
        />
        <div className="worker-state">
          <span>Creator worker</span>
          <strong className={snapshot.system.eventWorkerOnline ? "" : "is-danger"}>
            {snapshot.system.eventWorkerOnline ? "Онлайн" : "Нет heartbeat"}
          </strong>
        </div>
      </section>
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: "neutral" | "positive" | "danger";
}) {
  return (
    <article className={`metric metric--${tone}`}>
      <div className="metric__icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Period({
  label,
  views,
  unique,
}: {
  label: string;
  views: number;
  unique: number;
}) {
  return (
    <div className="period">
      <span>{label}</span>
      <strong>{unique}</strong>
      <small>{views} просмотров</small>
    </div>
  );
}

function Resource({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="resource">
      <div className="resource__label">
        {icon}
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="resource__track" aria-hidden="true">
        <span style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" aria-label="Загрузка данных">
      <div />
      <div className="loading-grid">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div />
    </div>
  );
}

export function providerName(provider: string) {
  if (provider === "twitch") return "Twitch";
  if (provider === "youtube") return "YouTube";
  return provider;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <Theme
        appearance="dark"
        accentColor="jade"
        grayColor="sage"
        radius="medium"
      >
        <App />
      </Theme>
    </StrictMode>,
  );
}
