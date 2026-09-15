import "@fontsource-variable/geist";
import {
  ArrowDown,
  ArrowRight,
  Broadcast,
  Calculator,
  Check,
  CheckCircle,
  Clock,
  Desktop,
  GameController,
  HardDrives,
  LockKey,
  MonitorPlay,
  ShieldCheck,
  SignIn,
  SignOut,
  TwitchLogo,
  UserCircle,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  initializeAccount,
  refreshAccount,
  registerAccount,
  signInAccount,
  signOutAccount,
  type AccountSession,
} from "./auth";
import "./styles.css";

const reveal = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" },
  transition: { duration: 0.52, ease: [0.16, 1, 0.3, 1] as const },
};

const emptySession: AccountSession = {
  authenticated: false,
  email: null,
  emailVerified: false,
  name: null,
  subject: null,
};

type AccountState = {
  session: AccountSession;
  status: "loading" | "ready" | "error";
  message: string;
};

function useAccount() {
  const [state, setState] = useState<AccountState>({
    session: emptySession,
    status: "loading",
    message: "",
  });

  useEffect(() => {
    let active = true;
    void initializeAccount()
      .then((session) => {
        if (active) {
          setState({ session, status: "ready", message: "" });
        }
      })
      .catch(() => {
        if (active) {
          setState({
            session: emptySession,
            status: "error",
            message:
              "Сервис аккаунтов временно недоступен. Castaryn Player продолжает работать без авторизации.",
          });
        }
      });

    const refreshTimer = window.setInterval(() => {
      void refreshAccount()
        .then((session) => {
          if (active) {
            setState({ session, status: "ready", message: "" });
          }
        })
        .catch(() => undefined);
    }, 45_000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  return state;
}

function App() {
  const account = useAccount();
  const isAccountPage = window.location.pathname.startsWith("/account");

  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robots) {
      robots.content = isAccountPage
        ? "noindex, nofollow"
        : "index, follow, max-image-preview:large";
    }
    document.title = isAccountPage
      ? "Аккаунт Castaryn"
      : "Castaryn — PvE-трекер и калькулятор фарма Perfect World";
  }, [isAccountPage]);

  useEffect(() => {
    void fetch("https://api.castaryn.ru/v1/site/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: window.location.pathname,
        referrer: document.referrer || undefined,
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  return (
    <div className="site-shell" id="top">
      <a className="skip-link" href="#main-content">
        Перейти к основному содержимому
      </a>
      <SiteHeader account={account} compact={isAccountPage} />
      {account.status === "error" && account.message ? (
        <div className="service-notice" role="status">
          <ShieldCheck size={16} />
          <span>{account.message}</span>
        </div>
      ) : null}
      {isAccountPage ? (
        <AccountPage account={account} />
      ) : (
        <LandingPage account={account} />
      )}
      <SiteFooter />
    </div>
  );
}

function SiteHeader({
  account,
  compact,
}: {
  account: AccountState;
  compact: boolean;
}) {
  return (
    <header className={compact ? "site-header site-header--compact" : "site-header"}>
      <a className="brand" href="/" aria-label="Castaryn, на главную">
        <img src="/castaryn-icon.png" alt="" width="38" height="38" />
        <span>Castaryn</span>
      </a>
      {!compact && (
        <nav aria-label="Основная навигация">
          <a href="#player">Возможности</a>
          <a href="#farm">Калькулятор</a>
          <a href="#creator">Стримерам</a>
          <a href="#safety">Безопасность</a>
        </nav>
      )}
      <div className="account-actions">
        {account.session.authenticated ? (
          <a className="account-chip" href="/account">
            <UserCircle size={18} />
            <span>{account.session.email ?? account.session.name ?? "Аккаунт"}</span>
          </a>
        ) : (
          <>
            <button
              className="account-link"
              type="button"
              disabled={account.status === "loading"}
              onClick={() => void signInAccount()}
            >
              Войти
            </button>
            <button
              className="header-action"
              type="button"
              disabled={account.status === "loading"}
              onClick={() => void registerAccount()}
            >
              Создать аккаунт
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function LandingPage({ account }: { account: AccountState }) {
  const reduceMotion = useReducedMotion();
  const motionProps = reduceMotion ? {} : reveal;

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-label">
            <Desktop size={16} />
            Windows-приложение для Perfect World
          </div>
          <h1>
            Фарм под контролем.
            <span>Стрим без лишней суеты.</span>
          </h1>
          <p>
            Castaryn ведёт PvE-прогресс, считает доходность фарма и связывает
            эфир с Twitch, YouTube и OBS.
          </p>
          <div className="hero-actions">
            <a className="button button--primary" href="#player">
              Изучить возможности
              <ArrowDown size={17} />
            </a>
            {account.session.authenticated ? (
              <a className="button button--quiet" href="/account">
                Открыть аккаунт
                <ArrowRight size={17} />
              </a>
            ) : (
              <button
                className="button button--quiet"
                type="button"
                disabled={account.status === "loading"}
                onClick={() => void registerAccount()}
              >
                Создать аккаунт стримера
                <ArrowRight size={17} />
              </button>
            )}
          </div>
          <div className="hero-trust" aria-label="Основные свойства Castaryn Player">
            <span><Check size={15} /> Без регистрации</span>
            <span><HardDrives size={15} /> Локальные данные</span>
            <span><ShieldCheck size={15} /> Без доступа к игре</span>
          </div>
        </div>

        <ProductPreview reduceMotion={reduceMotion === true} />
      </section>

      <section className="signal-strip" aria-label="Состав Castaryn">
        <div>
          <small>PLAYER</small>
          <strong>PvE-трекер и фарм</strong>
          <span>Работает локально</span>
        </div>
        <div>
          <small>CREATOR</small>
          <strong>Стриминг и интерактив</strong>
          <span>Доступны по аккаунту</span>
        </div>
        <div>
          <small>ПЛАТФОРМЫ</small>
          <strong>Twitch, YouTube, OBS</strong>
          <span>В одной системе</span>
        </div>
      </section>

      <section className="player-section" id="player">
        <motion.div className="player-copy" {...motionProps}>
          <span className="section-label">Castaryn Player</span>
          <h2>Начните без аккаунта и обязательных подключений</h2>
          <p>
            Создайте локальный профиль, настройте пачки и отмечайте
            прохождения. История и параметры остаются на вашем компьютере.
          </p>
          <div className="feature-lines">
            <div><CheckCircle size={20} /><span>Один персонаж или режим 10 окон</span></div>
            <div><CheckCircle size={20} /><span>Пачки, подземелья, таймеры и сундуки</span></div>
            <div><CheckCircle size={20} /><span>История по игровым дням</span></div>
            <div><CheckCircle size={20} /><span>Экспорт и восстановление локальной копии</span></div>
          </div>
        </motion.div>
        <motion.div className="day-visual" {...motionProps}>
          <div className="day-visual__header">
            <span>Сегодня</span>
            <small>Perfect World PvE</small>
          </div>
          <div className="day-visual__focus">
            <small>СЕЙЧАС</small>
            <strong>Остров Рыцарей</strong>
            <span>Пачка 3</span>
            <time>12:34</time>
          </div>
          <div className="day-visual__metrics">
            <div><span>Пачки</span><strong>2 / 4</strong></div>
            <div><span>Данжи</span><strong>8 / 16</strong></div>
            <div><span>Сундуки</span><strong>120</strong></div>
          </div>
        </motion.div>
      </section>

      <section className="farm-section" id="farm">
        <motion.div className="farm-visual" {...motionProps}>
          <div className="farm-visual__top">
            <div>
              <small>КАЛЬКУЛЯТОР ФАРМА</small>
              <strong>Реликвии</strong>
            </div>
            <Calculator size={28} />
          </div>
          <div className="farm-visual__result">
            <span>Ожидаемо за день</span>
            <strong>120 742 000</strong>
            <small>игровой валюты</small>
          </div>
          <div className="farm-visual__rows">
            <div><span>Остров Рыцарей</span><strong>58 400 000</strong></div>
            <div><span>Дворец Рассвета</span><strong>34 820 000</strong></div>
            <div><span>Ледяной ад</span><strong>27 522 000</strong></div>
          </div>
        </motion.div>
        <motion.div className="farm-copy" {...motionProps}>
          <span className="section-label">Калькулятор фарма Perfect World</span>
          <h2>Узнайте, сколько принесут ежедневные подземелья</h2>
          <p>
            Укажите количество персонажей, отметьте доступные подземелья и
            внесите цены предметов на вашем сервере. Castaryn рассчитает
            доходность каждого данжа и общий результат всего маршрута.
          </p>
          <div className="feature-lines">
            <div>
              <GameController size={20} />
              <span>От 1 до 10 персонажей и режим удвоенной награды</span>
            </div>
            <div>
              <Calculator size={20} />
              <span>Доспехи, оружие и реликвии с вашими ценами</span>
            </div>
            <div>
              <Clock size={20} />
              <span>Доход за день, неделю, 30 дней и минуту прохождения</span>
            </div>
            <div>
              <HardDrives size={20} />
              <span>Сохранённые расчёты остаются в локальной истории</span>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="creator-section" id="creator">
        <motion.div className="creator-copy" {...motionProps}>
          <span className="section-label">Castaryn Creator</span>
          <h2>Подключите канал, когда Player становится частью эфира</h2>
          <p>
            Один Castaryn Account открывает защищённые стриминговые функции.
            PvE-история при этом остаётся локальной и не загружается на сервер.
          </p>
          <div className="creator-actions">
            {account.session.authenticated ? (
              <a className="button button--primary" href="/account">
                Открыть аккаунт
                <ArrowRight size={17} />
              </a>
            ) : (
              <>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void registerAccount()}
                >
                  Создать аккаунт
                  <ArrowRight size={17} />
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => void signInAccount()}
                >
                  Уже есть аккаунт
                </button>
              </>
            )}
          </div>
        </motion.div>
        <motion.div className="creator-flow" {...motionProps}>
          <div className="creator-flow__step">
            <span>01</span>
            <UserCircle size={23} />
            <strong>Castaryn Account</strong>
            <small>Единая защищённая учётная запись</small>
          </div>
          <div className="creator-flow__step">
            <span>02</span>
            <Broadcast size={23} />
            <strong>Канал стримера</strong>
            <small>Привязка по Channel ID</small>
          </div>
          <div className="creator-flow__platforms">
            <div><TwitchLogo size={22} weight="fill" /><span>Twitch</span></div>
            <div><YoutubeLogo size={22} weight="fill" /><span>YouTube</span></div>
            <div><MonitorPlay size={22} /><span>OBS</span></div>
            <div><GameController size={22} /><span>Events</span></div>
          </div>
        </motion.div>
      </section>

      <section className="safety-section" id="safety">
        <motion.div className="section-copy section-copy--narrow" {...motionProps}>
          <span className="section-label">Без вмешательства в игру</span>
          <h2>Чёткая техническая граница</h2>
          <p>
            Castaryn работает рядом с Perfect World. Приложение не читает
            память, не управляет персонажем и не изменяет файлы клиента.
          </p>
        </motion.div>
        <div className="safety-grid">
          <motion.div {...motionProps}>
            <HardDrives size={24} />
            <strong>Локальный Player</strong>
            <span>Профиль, планы и история хранятся на компьютере.</span>
          </motion.div>
          <motion.div {...motionProps}>
            <LockKey size={24} />
            <strong>Отдельный Creator Account</strong>
            <span>Авторизация используется только стриминговыми функциями.</span>
          </motion.div>
          <motion.div {...motionProps}>
            <ShieldCheck size={24} />
            <strong>Минимальные разрешения</strong>
            <span>Каждая интеграция получает только необходимые права.</span>
          </motion.div>
        </div>
      </section>

      <section className="closing">
        <motion.div {...motionProps}>
          <span className="section-label">Закрытое тестирование</span>
          <h2>Player уже работает. Creator подключается тогда, когда нужен вам.</h2>
          <p>
            Создайте аккаунт сейчас или продолжайте использовать локальные
            функции без регистрации.
          </p>
          <div className="closing__actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void registerAccount()}
            >
              Создать Castaryn Account
              <ArrowRight size={17} />
            </button>
            <a className="button button--quiet" href="#top">
              Вернуться к началу
            </a>
          </div>
        </motion.div>
      </section>
    </main>
  );
}

function ProductPreview({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      className="product-frame"
      initial={reduceMotion ? undefined : { opacity: 0, x: 28, rotateY: -3 }}
      animate={{ opacity: 1, x: 0, rotateY: 0 }}
      transition={{ duration: 0.82, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="product-frame__bar">
        <span />
        <strong>Castaryn Player</strong>
        <small>Локальные данные</small>
      </div>
      <div className="product-preview" aria-label="Пример интерфейса Castaryn">
        <aside className="product-preview__nav" aria-hidden="true">
          <img src="/castaryn-icon.png" alt="" width="26" height="26" />
          <span className="is-active">Сегодня</span>
          <span>История</span>
          <span>Фарм</span>
          <span>Стриминг</span>
          <span>Помощь</span>
        </aside>
        <div className="product-preview__content">
          <div className="product-preview__heading">
            <div><small>PERFECT WORLD · PVE</small><strong>Сегодня</strong></div>
            <span>Данные сохранены</span>
          </div>
          <div className="product-preview__stats">
            <div><small>Пачки</small><strong>2 / 4</strong></div>
            <div><small>Подземелья</small><strong>8 / 16</strong></div>
            <div><small>Сундуки</small><strong>120</strong></div>
          </div>
          <div className="product-preview__activity">
            <div>
              <small>СЕЙЧАС</small>
              <strong>Остров Рыцарей</strong>
              <span>Пачка 3 · прохождение</span>
            </div>
            <time>12:34</time>
          </div>
          <div className="product-preview__list">
            <span><i />Терраса снов <b>Завершено</b></span>
            <span><i />Гробница шепотов <b>Завершено</b></span>
            <span className="is-current"><i />Остров Рыцарей <b>В процессе</b></span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AccountPage({ account }: { account: AccountState }) {
  return (
    <main className="account-page" id="main-content" tabIndex={-1}>
      <section className="account-panel">
        <div className="account-panel__intro">
          <span className="section-label">Castaryn Account</span>
          <h1>
            {account.status === "loading"
              ? "Проверяем сессию"
              : account.session.authenticated
                ? "Аккаунт подключён"
                : "Войдите или создайте аккаунт"}
          </h1>
          <p>
            Аккаунт используется только для Creator-функций. Castaryn Player,
            PvE-планы и история продолжают храниться локально.
          </p>
        </div>

        <div className="account-card">
          {account.status === "loading" ? (
            <div className="account-loading" aria-live="polite">
              <span />
              <strong>Безопасное подключение</strong>
              <small>Это займёт несколько секунд.</small>
            </div>
          ) : account.session.authenticated ? (
            <>
              <div className="account-identity">
                <div className="account-avatar">
                  {(account.session.email ?? account.session.name ?? "C")
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
                <div>
                  <span>Вы вошли как</span>
                  <strong>{account.session.email ?? account.session.name}</strong>
                  <small>
                    {account.session.emailVerified
                      ? "Email подтверждён"
                      : "Castaryn Account"}
                  </small>
                </div>
              </div>
              <div className="account-next">
                <span>Следующий шаг</span>
                <strong>Откройте Castaryn на Windows</strong>
                <p>
                  Перейдите в раздел «Стриминг» и нажмите «Войти». Активная
                  сессия браузера позволит продолжить без повторной регистрации.
                </p>
              </div>
              <div className="account-card__actions">
                <a className="button button--primary" href="/#creator">
                  Инструкция Creator
                  <ArrowRight size={17} />
                </a>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => void signOutAccount()}
                >
                  <SignOut size={17} />
                  Выйти
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="account-choice">
                <div>
                  <UserCircle size={26} />
                  <strong>Новый пользователь</strong>
                  <p>Создайте аккаунт по email и продолжите настройку Creator.</p>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void registerAccount()}
                  >
                    Создать аккаунт
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div>
                  <SignIn size={26} />
                  <strong>Уже есть аккаунт</strong>
                  <p>Войдите в существующий Castaryn Account.</p>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => void signInAccount()}
                  >
                    Войти
                  </button>
                </div>
              </div>
              {account.message && (
                <p className="account-error" role="status">{account.message}</p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="brand brand--footer">
        <img src="/castaryn-icon.png" alt="" width="34" height="34" />
        <span>Castaryn</span>
      </div>
      <p>
        Независимый инструмент для игроков и стримеров. Не связан с
        правообладателями Perfect World.
      </p>
      <span>Windows · Русский язык</span>
    </footer>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
