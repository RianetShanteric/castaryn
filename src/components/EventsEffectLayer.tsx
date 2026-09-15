import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  acknowledgeEventEffect,
  fetchCreatorAccess,
  getEventEffectCursor,
  heartbeatEventDesktop,
  listEventEffects,
  restoreCreatorLogin,
  type DispatchedEffect,
} from "../lib/creator-client";

const memes = [
  "ЧАТ АТАКУЕТ",
  "МЫ ВСЁ ВИДИМ",
  "ВНИМАНИЕ! АКТИВИРОВАН ХАОС",
  "НЕ ПОВЕЗЛО",
  "ЗРИТЕЛЬ НАЖАЛ КНОПКУ ХАОСА",
];
const screamers = [
  "/events/screamers/screamer-1.webp",
  "/events/screamers/screamer-2.webp",
  "/events/screamers/screamer-3.webp",
  "/events/screamers/screamer-4.webp",
  "/events/screamers/screamer-5.webp",
];
const systemEffects = new Set([
  "rotate",
  "mouse_block",
  "keyboard_block",
  "key_shuffle",
  "lag",
  "mouse_invert",
]);

function stableIndex(value: string, length: number) {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % length;
}

function assetIndex(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
    ? value - 1
    : null;
}

function effectTitle(effect: DispatchedEffect) {
  if (effect.effect.kind === "meme") {
    const index = assetIndex(effect.effect.parameters.memeAsset);
    return memes[index ?? stableIndex(effect.id, memes.length)]!;
  }
  const configuredName = effect.effect.parameters.displayName;
  if (typeof configuredName === "string" && configuredName.trim()) {
    return configuredName;
  }
  switch (effect.effect.kind) {
    case "screamer":
      return "СКРИМЕР";
    case "sound":
      return "🔊";
    case "darkness":
      return "ТЬМА";
    case "rotate":
      return "МИР ПЕРЕВЕРНУЛСЯ";
    case "mouse_block":
      return "МЫШЬ ЗАБЛОКИРОВАНА";
    case "keyboard_block":
      return "КЛАВИАТУРА ЗАБЛОКИРОВАНА";
    case "key_shuffle":
      return "КЛАВИШИ ПЕРЕМЕШАНЫ";
    case "lag":
      return "СИГНАЛ ЗАДЕРЖАН";
    case "mouse_invert":
      return "МЫШЬ ИНВЕРТИРОВАНА";
    default:
      return "CASTARYN EVENT";
  }
}

function playEffectSound(effect: DispatchedEffect) {
  if (!["screamer", "sound"].includes(effect.effect.kind)) return null;
  try {
    const selected = assetIndex(effect.effect.parameters.audioAsset);
    const index = selected ?? stableIndex(effect.id, 5);
    const prefix = effect.effect.kind === "screamer" ? "screamer" : "sound";
    const audio = new Audio(`/events/audio/${prefix}-${index + 1}.wav`);
    audio.preload = "auto";
    audio.volume = effect.effect.kind === "screamer" ? 0.82 : 0.72;
    void audio.play();
    return audio;
  } catch {
    return null;
  }
}

export function EventsEffectLayer() {
  const [active, setActive] = useState<DispatchedEffect | null>(null);
  const [systemError, setSystemError] = useState("");
  const [sessionRevision, setSessionRevision] = useState(0);
  const queue = useRef<DispatchedEffect[]>([]);
  const running = useRef(false);
  const activeAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handleSessionChange = () =>
      setSessionRevision((revision) => revision + 1);
    const stopAllEffects = () => {
      queue.current = [];
      running.current = false;
      setActive(null);
      activeAudio.current?.pause();
      activeAudio.current = null;
      if (isTauri()) {
        void invoke("cancel_system_effect").catch(() => undefined);
      }
    };
    window.addEventListener(
      "castaryn-creator-session-changed",
      handleSessionChange,
    );
    window.addEventListener("castaryn-stop-all-effects", stopAllEffects);
    return () => {
      window.removeEventListener(
        "castaryn-creator-session-changed",
        handleSessionChange,
      );
      window.removeEventListener("castaryn-stop-all-effects", stopAllEffects);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<string>("castaryn-system-effect-error", (event) => {
      setSystemError(event.payload);
      window.setTimeout(() => setSystemError(""), 12_000);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let disposed = false;
    let pollTimer: number | undefined;
    let effectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let cursor = "0";
    let initialized = false;
    let controlRevision: string | null = null;
    let creatorId: string | null = null;
    const consumerId =
      window.localStorage.getItem("castaryn-events-consumer") ??
      window.localStorage.getItem("elyvo-events-consumer") ??
      crypto.randomUUID();
    window.localStorage.setItem("castaryn-events-consumer", consumerId);
    window.localStorage.removeItem("elyvo-events-consumer");

    const runNext = async () => {
      if (disposed || running.current || queue.current.length === 0) return;
      const next = queue.current.shift()!;
      running.current = true;
      let systemEffectStarted = false;
      try {
        if (systemEffects.has(next.effect.kind)) {
          if (!isTauri()) throw new Error("Windows client is required");
          await invoke("apply_system_effect", {
            effect: next.effect.kind,
            durationSeconds: next.effect.durationSeconds,
          });
          systemEffectStarted = true;
        }
        if (!creatorId) throw new Error("Creator session is unavailable");
        await acknowledgeEventEffect(creatorId, next.id);
      } catch (error) {
        if (systemEffectStarted) {
          await invoke("cancel_system_effect").catch(() => undefined);
        }
        if (systemEffects.has(next.effect.kind)) {
          setSystemError(
            error instanceof Error
              ? `Системный эффект не запущен: ${error.message}`
              : "Системный эффект не запущен.",
          );
          window.setTimeout(() => setSystemError(""), 8_000);
        }
        running.current = false;
        void runNext();
        return;
      }
      setActive(next);
      activeAudio.current = playEffectSound(next);
      effectTimer = window.setTimeout(() => {
        activeAudio.current?.pause();
        activeAudio.current = null;
        setActive(null);
        running.current = false;
        void runNext();
      }, Math.max(1, next.effect.durationSeconds) * 1_000 +
        (systemEffects.has(next.effect.kind) ? 250 : 0));
    };

    void (async () => {
      if (!(await restoreCreatorLogin()) || disposed) return;
      const access = await fetchCreatorAccess();
      if (
        !access.active ||
        !access.creatorIdentityId ||
        !access.features.includes("events")
      ) {
        return;
      }
      const activeCreatorId = access.creatorIdentityId;
      creatorId = activeCreatorId;
      const synchronize = async () => {
        const heartbeat = await heartbeatEventDesktop(
          activeCreatorId,
          consumerId,
        );
        if (
          controlRevision !== null &&
          controlRevision !== heartbeat.controlRevision
        ) {
          window.clearTimeout(effectTimer);
          queue.current = [];
          running.current = false;
          setActive(null);
          cursor = (await getEventEffectCursor(activeCreatorId)).sequence;
        }
        controlRevision = heartbeat.controlRevision;
      };
      await synchronize();
      cursor = (await getEventEffectCursor(activeCreatorId)).sequence;
      initialized = true;
      heartbeatTimer = window.setInterval(
        () => void synchronize().catch(() => undefined),
        3_000,
      );
      const poll = async () => {
        if (!initialized) return;
        try {
          const effects = await listEventEffects(activeCreatorId, cursor);
          const now = Date.now();
          for (const effect of effects) {
            cursor = effect.sequence;
            if (now - new Date(effect.createdAt).getTime() <= 15_000) {
              queue.current.push(effect);
            }
          }
          void runNext();
        } finally {
          if (!disposed) pollTimer = window.setTimeout(() => void poll(), 750);
        }
      };
      await poll();
    })().catch(() => undefined);

    return () => {
      disposed = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(effectTimer);
      window.clearInterval(heartbeatTimer);
      queue.current = [];
      running.current = false;
      activeAudio.current?.pause();
      activeAudio.current = null;
      if (isTauri()) {
        void invoke("cancel_system_effect").catch(() => undefined);
      }
    };
  }, [sessionRevision]);

  useEffect(() => {
    if (!active) return;
    const className = `castaryn-event-${active.effect.kind}`;
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [active]);

  if (!active) {
    return systemError ? (
      <div className="desktop-event-error" role="alert">
        {systemError}
      </div>
    ) : null;
  }
  const screamerAsset =
    active.effect.kind === "screamer"
      ? screamers[
          assetIndex(active.effect.parameters.visualAsset) ??
            stableIndex(active.id, screamers.length)
        ]!
      : null;
  if (active.effect.kind === "sound") return null;
  return (
    <div
      className={`desktop-event-effect desktop-event-effect--${active.effect.kind}`}
      role="status"
      aria-live="assertive"
    >
      {screamerAsset ? (
        <img
          className="desktop-event-effect__screamer"
          src={screamerAsset}
          alt=""
        />
      ) : (
        <strong>{effectTitle(active)}</strong>
      )}
      <span>Активировал {active.viewerName}</span>
    </div>
  );
}
