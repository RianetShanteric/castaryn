import { Broadcast, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  buildOverlayUrl,
  getOverlay,
  loadOverlayUrl,
  rememberOverlayToken,
  saveOverlay,
  type OverlayField,
} from "../lib/creator-client";
import { formatDuration } from "../domain/format-duration";
import { usePublicStreamState } from "../hooks/usePublicStreamState";

const overlayFields: Array<{
  id: OverlayField;
  label: string;
}> = [
  { id: "activity", label: "Текущая активность" },
  { id: "pack", label: "Пачка" },
  { id: "dungeon", label: "Данж" },
  { id: "next_dungeon", label: "Следующий данж" },
  { id: "daily_quest", label: "Сегодняшняя ежа" },
  { id: "inventory_chests", label: "Сундуки в инвентаре" },
  { id: "timer", label: "Таймер" },
  { id: "progress", label: "Прогресс" },
  { id: "chests", label: "Сундуки" },
  { id: "farm_time", label: "Время фарма" },
  { id: "server", label: "Сервер" },
];

export function OverlayPanel({ creatorId }: { creatorId: string }) {
  const state = usePublicStreamState();
  const [fields, setFields] = useState<OverlayField[]>([
    "activity",
    "pack",
    "dungeon",
    "timer",
    "progress",
    "chests",
  ]);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadOverlayUrl(creatorId), getOverlay(creatorId)])
      .then(([url, configuration]) => {
        if (disposed) return;
        setOverlayUrl(url);
        if (configuration) {
          setFields(
            configuration.visibleFields.filter((field): field is OverlayField =>
              overlayFields.some((option) => option.id === field),
            ),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [creatorId]);

  async function persistOverlay(rotateToken: boolean) {
    setMessage("");
    try {
      const result = await saveOverlay(
        creatorId,
        fields,
        rotateToken,
      );
      if (result.publicToken) {
        await rememberOverlayToken(creatorId, result.publicToken);
        setOverlayUrl(await buildOverlayUrl(result.publicToken));
        setMessage(
          rotateToken
            ? "Новая ссылка создана. Предыдущая ссылка отключена."
            : "Защищённая ссылка создана.",
        );
      } else {
        setMessage("Настройки сохранены. Ссылка OBS осталась прежней.");
      }
    } catch {
      setMessage("Не удалось сохранить overlay.");
    }
  }

  return (
    <div className="creator-module overlay-module">
      <div>
        <div className="creator-module__title">
          <div>
            <strong>OBS Overlay</strong>
            <span>Один тёмный read-only источник</span>
          </div>
        </div>
        <div className="overlay-field-list">
          {overlayFields.map((field) => (
            <label key={field.id}>
              <input
                type="checkbox"
                checked={fields.includes(field.id)}
                onChange={() =>
                  setFields((current) =>
                    current.includes(field.id)
                      ? current.filter((item) => item !== field.id)
                      : [...current, field.id],
                  )
                }
              />
              <span>{field.label}</span>
            </label>
          ))}
        </div>
        <button
          className="primary-button"
          disabled={fields.length === 0}
          onClick={() => void persistOverlay(false)}
        >
          <Broadcast /> Сохранить overlay
        </button>
        <button
          className="secondary-button overlay-rotate-button"
          disabled={fields.length === 0}
          onClick={() => void persistOverlay(true)}
        >
          Создать новую ссылку
        </button>
        {overlayUrl && (
          <div className="overlay-url">
            <input value={overlayUrl} readOnly />
            <button
              className="icon-action"
              aria-label="Скопировать ссылку"
              onClick={() => void navigator.clipboard.writeText(overlayUrl)}
            >
              <Copy />
            </button>
          </div>
        )}
        {message && <span className="module-message">{message}</span>}
      </div>
      <OverlayPreview fields={fields} state={state} />
    </div>
  );
}

function OverlayPreview({
  fields,
  state,
}: {
  fields: OverlayField[];
  state: ReturnType<typeof usePublicStreamState>;
}) {
  return (
    <div className="overlay-preview">
      <span className="overlay-preview__label">Предпросмотр OBS</span>
      {fields.includes("activity") && (
        <small>{state.activity ?? "Perfect World PvE"}</small>
      )}
      {fields.includes("dungeon") && (
        <strong>{state.dungeon ?? "Данж не выбран"}</strong>
      )}
      {fields.includes("next_dungeon") && state.nextDungeon && (
        <small>Дальше: {state.nextDungeon}</small>
      )}
      {fields.includes("daily_quest") && state.dailyQuest && (
        <small>Ежа: {state.dailyQuest}</small>
      )}
      <div>
        {fields.includes("pack") && (
          <span>{state.pack ?? "Пачка не выбрана"}</span>
        )}
        {fields.includes("timer") && (
          <span>{formatDuration(state.timerSeconds)}</span>
        )}
      </div>
      {fields.includes("progress") && (
        <p>
          Пачки {state.packsDone}/{state.packsTotal} · Данжи{" "}
          {state.dungeonsDone}/{state.dungeonsTotal}
        </p>
      )}
      {fields.includes("chests") && (
        <b>{state.chests} сундуков</b>
      )}
      {fields.includes("inventory_chests") && (
        <b>В инвентаре: {state.inventoryChests}</b>
      )}
    </div>
  );
}
