import {
  ArrowCounterClockwise,
  Crown,
  Monitor,
  Play,
  Stop,
  Sword,
  Trash,
  Trophy,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { PageHeading } from "../components/PageHeading";
import { formatDuration } from "../domain/format-duration";
import {
  type ArenaMode,
  type ArenaResult,
  useCastarynStore,
} from "../store/castaryn-store";

const modeLabels: Record<ArenaMode, string> = {
  order: "Порядок",
  chaos: "Хаос",
};

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function PvpView() {
  const [arenaMode, setArenaMode] = useState<ArenaMode>("order");
  const [ratingDraft, setRatingDraft] = useState("");
  const [ratingChange, setRatingChange] = useState("10");
  const [editingLast, setEditingLast] = useState(false);
  const [editResult, setEditResult] = useState<ArenaResult>("win");
  const [editChange, setEditChange] = useState("10");
  const [placement, setPlacement] = useState("");

  const activeRun = useCastarynStore((state) => state.activeRun);
  const arenaRatings = useCastarynStore((state) => state.arenaRatings);
  const arenaMatches = useCastarynStore((state) => state.arenaMatches);
  const setArenaRating = useCastarynStore((state) => state.setArenaRating);
  const recordArenaMatch = useCastarynStore(
    (state) => state.recordArenaMatch,
  );
  const amendLastArenaMatch = useCastarynStore(
    (state) => state.amendLastArenaMatch,
  );
  const deleteLastArenaMatch = useCastarynStore(
    (state) => state.deleteLastArenaMatch,
  );
  const activeImperialRun = useCastarynStore(
    (state) => state.activeImperialRun,
  );
  const imperialBattles = useCastarynStore(
    (state) => state.imperialBattles,
  );
  const startImperialBattle = useCastarynStore(
    (state) => state.startImperialBattle,
  );
  const finishImperialBattle = useCastarynStore(
    (state) => state.finishImperialBattle,
  );
  const cancelImperialBattle = useCastarynStore(
    (state) => state.cancelImperialBattle,
  );
  const updateImperialPlacement = useCastarynStore(
    (state) => state.updateImperialPlacement,
  );
  const deleteImperialBattle = useCastarynStore(
    (state) => state.deleteImperialBattle,
  );

  const modeMatches = useMemo(
    () => arenaMatches.filter((match) => match.mode === arenaMode),
    [arenaMatches, arenaMode],
  );
  const wins = modeMatches.filter((match) => match.result === "win").length;
  const losses = modeMatches.length - wins;
  const lastMatch = modeMatches[0] ?? null;
  const currentRating = arenaRatings[arenaMode];
  const initialRating =
    modeMatches.length > 0
      ? modeMatches[modeMatches.length - 1]!.ratingBefore
      : currentRating;
  const ratingDiff =
    currentRating !== null && initialRating !== null
      ? currentRating - initialRating
      : 0;
  const recentChanges = Array.from(
    new Set(modeMatches.map((match) => Math.abs(match.ratingDelta))),
  )
    .filter((value) => value > 0)
    .slice(0, 4);

  const knownPlacements = imperialBattles
    .map((battle) => battle.placement)
    .filter((value): value is number => value !== null);
  const averagePlacement =
    knownPlacements.length > 0
      ? knownPlacements.reduce((sum, value) => sum + value, 0) /
        knownPlacements.length
      : null;
  const totalImperialSeconds = imperialBattles.reduce(
    (sum, battle) => sum + battle.durationSeconds,
    0,
  );
  const historyDays = useMemo(() => {
    const days = new Map<
      string,
      Array<
        | { type: "arena"; timestamp: string; match: (typeof arenaMatches)[number] }
        | {
            type: "imperial";
            timestamp: string;
            battle: (typeof imperialBattles)[number];
          }
      >
    >();
    arenaMatches.forEach((match) => {
      const entries = days.get(match.dayKey) ?? [];
      entries.push({ type: "arena", timestamp: match.playedAt, match });
      days.set(match.dayKey, entries);
    });
    imperialBattles.forEach((battle) => {
      const entries = days.get(battle.dayKey) ?? [];
      entries.push({
        type: "imperial",
        timestamp: battle.startedAt,
        battle,
      });
      days.set(battle.dayKey, entries);
    });
    return Array.from(days.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 30)
      .map(([dayKey, entries]) => ({
        dayKey,
        entries: entries.sort((left, right) =>
          right.timestamp.localeCompare(left.timestamp),
        ),
      }));
  }, [arenaMatches, imperialBattles]);

  const saveArenaResult = (result: ArenaResult) => {
    const amount = Number(ratingChange);
    if (!Number.isFinite(amount) || amount < 0) return;
    recordArenaMatch(arenaMode, result, amount);
  };

  const beginEditLast = () => {
    if (!lastMatch) return;
    setEditResult(lastMatch.result);
    setEditChange(String(Math.abs(lastMatch.ratingDelta)));
    setEditingLast(true);
  };

  return (
    <>
      <PageHeading
        title="PvP"
        description="Ручной трекер Арены Авроры и Императорской битвы. Castaryn не подключается к игровому клиенту."
        action={
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("castaryn-toggle-focus-panel"),
              )
            }
          >
            <Monitor size={17} />
            Мини-панель
          </button>
        }
      />

      <div className="pvp-layout">
        <section className="pvp-card pvp-card--arena">
          <div className="pvp-card__heading">
            <div className="pvp-card__icon">
              <Sword size={22} />
            </div>
            <div>
              <span>Арена Авроры</span>
              <h2>Рейтинг и результаты</h2>
            </div>
          </div>

          <div className="pvp-mode-switch" role="tablist">
            {(["order", "chaos"] as ArenaMode[]).map((mode) => (
              <button
                type="button"
                role="tab"
                aria-selected={arenaMode === mode}
                className={arenaMode === mode ? "is-active" : ""}
                onClick={() => {
                  setArenaMode(mode);
                  setEditingLast(false);
                  setRatingDraft("");
                }}
                key={mode}
              >
                <strong>{modeLabels[mode]}</strong>
                <span>
                  {mode === "order"
                    ? "Равная экипировка"
                    : "Собственная экипировка"}
                </span>
              </button>
            ))}
          </div>

          {currentRating === null ? (
            <div className="pvp-rating-setup">
              <div>
                <span>Начальный рейтинг</span>
                <p>
                  Укажите текущее значение один раз. Дальше рейтинг изменяется
                  фактическими очками каждого матча.
                </p>
              </div>
              <div className="pvp-inline-form">
                <input
                  type="number"
                  min={0}
                  max={99999}
                  inputMode="numeric"
                  placeholder="Например, 1800"
                  value={ratingDraft}
                  onChange={(event) => setRatingDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={!ratingDraft}
                  onClick={() => {
                    setArenaRating(arenaMode, Number(ratingDraft));
                    setRatingDraft("");
                  }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="pvp-metrics">
                <div>
                  <span>Рейтинг</span>
                  <strong>{currentRating}</strong>
                  <small className={ratingDiff >= 0 ? "is-positive" : "is-negative"}>
                    {signed(ratingDiff)} за всю историю
                  </small>
                </div>
                <div>
                  <span>Бои</span>
                  <strong>{modeMatches.length}</strong>
                  <small>
                    {wins} побед · {losses} поражений
                  </small>
                </div>
                <div>
                  <span>Победы</span>
                  <strong>
                    {modeMatches.length
                      ? `${Math.round((wins / modeMatches.length) * 100)}%`
                      : "—"}
                  </strong>
                  <small>{modeLabels[arenaMode]}</small>
                </div>
              </div>

              <div className="pvp-result-entry">
                <div>
                  <span>Изменение рейтинга</span>
                  <p>Введите число, которое показала игра после боя.</p>
                </div>
                <div className="pvp-change-input">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    inputMode="numeric"
                    value={ratingChange}
                    onChange={(event) => setRatingChange(event.target.value)}
                  />
                  {recentChanges.length > 0 && (
                    <div className="pvp-quick-values">
                      {recentChanges.map((value) => (
                        <button
                          type="button"
                          onClick={() => setRatingChange(String(value))}
                          key={value}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pvp-result-buttons">
                  <button
                    type="button"
                    className="pvp-result-button pvp-result-button--win"
                    onClick={() => saveArenaResult("win")}
                  >
                    <Trophy size={19} weight="fill" />
                    Победа
                    <span>+{Math.max(0, Number(ratingChange) || 0)}</span>
                  </button>
                  <button
                    type="button"
                    className="pvp-result-button pvp-result-button--loss"
                    onClick={() => saveArenaResult("loss")}
                  >
                    <Sword size={19} />
                    Поражение
                    <span>−{Math.max(0, Number(ratingChange) || 0)}</span>
                  </button>
                </div>
              </div>

              {lastMatch && (
                <div className="pvp-last-result">
                  <div>
                    <span>Последний бой</span>
                    <strong>
                      {lastMatch.result === "win" ? "Победа" : "Поражение"} ·{" "}
                      {signed(lastMatch.ratingDelta)}
                    </strong>
                    <small>
                      {lastMatch.ratingBefore} → {lastMatch.ratingAfter}
                    </small>
                  </div>
                  {editingLast ? (
                    <div className="pvp-edit-result">
                      <div
                        className="pvp-edit-result__outcome"
                        role="group"
                        aria-label="Исправленный результат боя"
                      >
                        <button
                          type="button"
                          className={editResult === "win" ? "is-active" : ""}
                          onClick={() => setEditResult("win")}
                        >
                          Победа
                        </button>
                        <button
                          type="button"
                          className={editResult === "loss" ? "is-active" : ""}
                          onClick={() => setEditResult("loss")}
                        >
                          Поражение
                        </button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={editChange}
                        onChange={(event) => setEditChange(event.target.value)}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          amendLastArenaMatch(
                            arenaMode,
                            editResult,
                            Number(editChange),
                          );
                          setEditingLast(false);
                        }}
                      >
                        Сохранить
                      </button>
                    </div>
                  ) : (
                    <div className="pvp-last-result__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={beginEditLast}
                      >
                        Исправить
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Удалить последний результат"
                        onClick={() => {
                          if (window.confirm("Удалить последний результат боя?")) {
                            deleteLastArenaMatch(arenaMode);
                          }
                        }}
                      >
                        <Trash size={18} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="pvp-card pvp-card--imperial">
          <div className="pvp-card__heading">
            <div className="pvp-card__icon">
              <Crown size={22} />
            </div>
            <div>
              <span>Императорская битва</span>
              <h2>Бои, время и место</h2>
            </div>
          </div>

          <div className="pvp-metrics pvp-metrics--imperial">
            <div>
              <span>Бои</span>
              <strong>{imperialBattles.length}</strong>
              <small>{knownPlacements.length} с указанным местом</small>
            </div>
            <div>
              <span>Лучшее место</span>
              <strong>
                {knownPlacements.length ? Math.min(...knownPlacements) : "—"}
              </strong>
              <small>
                {averagePlacement === null
                  ? "Нет результатов"
                  : `Среднее ${averagePlacement.toFixed(1)}`}
              </small>
            </div>
            <div>
              <span>Общее время</span>
              <strong>{formatDuration(totalImperialSeconds)}</strong>
              <small>
                {imperialBattles.length
                  ? `Среднее ${formatDuration(
                      Math.round(totalImperialSeconds / imperialBattles.length),
                    )}`
                  : "Таймер ещё не запускался"}
              </small>
            </div>
          </div>

          {activeImperialRun ? (
            <div className="imperial-live">
              <div>
                <span className="live-badge">Бой идёт</span>
                <strong>
                  {formatDuration(activeImperialRun.elapsedSeconds)}
                </strong>
                <p>Место можно оставить пустым и добавить позднее.</p>
              </div>
              <label>
                <span>Место, если известно</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  placeholder="Необязательно"
                  value={placement}
                  onChange={(event) => setPlacement(event.target.value)}
                />
              </label>
              <div className="imperial-live__actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    finishImperialBattle(
                      placement ? Number(placement) : null,
                    );
                    setPlacement("");
                  }}
                >
                  <Stop size={17} weight="fill" />
                  Завершить бой
                </button>
                <button
                  type="button"
                  className="danger-ghost-button"
                  onClick={() => {
                    cancelImperialBattle();
                    setPlacement("");
                  }}
                >
                  Отменить
                </button>
              </div>
            </div>
          ) : (
            <div className="imperial-start">
              <div>
                <span>Новый бой</span>
                <p>
                  Таймер восстановится после перезапуска приложения. Результат
                  сохранится только после завершения.
                </p>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={activeRun !== null}
                onClick={startImperialBattle}
              >
                <Play size={17} weight="fill" />
                Начать бой
              </button>
              {activeRun && (
                <small>Сначала завершите активный PvE-таймер.</small>
              )}
            </div>
          )}

          {imperialBattles.length > 0 && (
            <div className="imperial-history">
              <div className="imperial-history__heading">
                <div>
                  <span>История</span>
                  <h3>Последние бои</h3>
                </div>
                <ArrowCounterClockwise size={20} />
              </div>
              {imperialBattles.slice(0, 8).map((battle, index) => (
                <div className="imperial-history__row" key={battle.id}>
                  <div>
                    <strong>Бой №{imperialBattles.length - index}</strong>
                    <span>
                      {new Date(battle.startedAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <span>{formatDuration(battle.durationSeconds)}</span>
                  <label>
                    <span>Место</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      inputMode="numeric"
                      placeholder="—"
                      defaultValue={battle.placement ?? ""}
                      onBlur={(event) =>
                        updateImperialPlacement(
                          battle.id,
                          event.target.value
                            ? Number(event.target.value)
                            : null,
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Удалить бой"
                    onClick={() => {
                      if (window.confirm("Удалить этот бой из истории?")) {
                        deleteImperialBattle(battle.id);
                      }
                    }}
                  >
                    <Trash size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {historyDays.length > 0 && (
        <section className="pvp-history">
          <div className="pvp-history__heading">
            <div>
              <span>Локальная история</span>
              <h2>Результаты по дням</h2>
            </div>
            <small>Арена и Императорская битва</small>
          </div>
          {historyDays.map((day) => (
            <div className="pvp-history__day" key={day.dayKey}>
              <div className="pvp-history__date">
                <strong>
                  {new Date(`${day.dayKey}T00:00:00`).toLocaleDateString(
                    "ru-RU",
                    { day: "numeric", month: "long", year: "numeric" },
                  )}
                </strong>
                <span>{day.entries.length} записей</span>
              </div>
              <div className="pvp-history__entries">
                {day.entries.map((entry) =>
                  entry.type === "arena" ? (
                    <div
                      className="pvp-history__entry"
                      key={entry.match.id}
                    >
                      <span className="pvp-history__type">Арена</span>
                      <div>
                        <strong>
                          {entry.match.result === "win"
                            ? "Победа"
                            : "Поражение"}
                        </strong>
                        <span>{modeLabels[entry.match.mode]}</span>
                      </div>
                      <strong
                        className={
                          entry.match.ratingDelta >= 0
                            ? "is-positive"
                            : "is-negative"
                        }
                      >
                        {signed(entry.match.ratingDelta)}
                      </strong>
                      <span>
                        {entry.match.ratingBefore} →{" "}
                        {entry.match.ratingAfter}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="pvp-history__entry"
                      key={entry.battle.id}
                    >
                      <span className="pvp-history__type">ИБ</span>
                      <div>
                        <strong>Императорская битва</strong>
                        <span>
                          {entry.battle.placement
                            ? `${entry.battle.placement}-е место`
                            : "Место не указано"}
                        </span>
                      </div>
                      <strong>
                        {formatDuration(entry.battle.durationSeconds)}
                      </strong>
                      <span>
                        {new Date(entry.battle.startedAt).toLocaleTimeString(
                          "ru-RU",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
