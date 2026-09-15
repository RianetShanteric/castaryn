import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  disable,
  enable,
  isEnabled,
} from "@tauri-apps/plugin-autostart";
import { useCastarynStore } from "../store/castaryn-store";
import { publishShortcutStatus } from "./shortcut-status";

let shortcutRegistrationQueue = Promise.resolve();

export function PlayerAutomation() {
  const settings = useCastarynStore((state) => state.interfaceSettings);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stopListening: (() => void) | null = null;

    publishShortcutStatus({ status: "checking" });
    shortcutRegistrationQueue = shortcutRegistrationQueue.then(async () => {
      if (disposed) return;
      try {
        if (settings.primaryShortcut === settings.undoShortcut) {
          throw new Error(
            "Основное действие и отмена не могут использовать одну клавишу.",
          );
        }
        stopListening = await listen<string>(
          "castaryn-hotkey-action",
          (event) => {
            if (event.payload === "primary") {
              useCastarynStore.getState().routePrimaryAction();
            } else if (event.payload === "undo") {
              useCastarynStore.getState().undoRouteAction();
            }
          },
        );
        await invoke("configure_hotkey_helper", {
          primaryShortcut: settings.primaryShortcut,
          undoShortcut: settings.undoShortcut,
        });
        if (disposed) {
          stopListening?.();
          stopListening = null;
          return;
        }
        publishShortcutStatus({ status: "ready" });
      } catch (error) {
        stopListening?.();
        stopListening = null;
        if (!disposed) {
          publishShortcutStatus({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : "Не удалось зарегистрировать горячие клавиши.",
          });
        }
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
      stopListening = null;
    };
  }, [settings.primaryShortcut, settings.undoShortcut]);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const enabled = await isEnabled();
      if (settings.startWithWindows && !enabled) await enable();
      if (!settings.startWithWindows && enabled) await disable();
    })().catch(() => undefined);
  }, [settings.startWithWindows]);

  return null;
}
