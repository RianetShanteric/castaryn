import { useSyncExternalStore } from "react";

export const shortcutStatusEvent = "castaryn-shortcut-status";

export interface ShortcutStatus {
  status: "checking" | "ready" | "error";
  message?: string;
}

let currentShortcutStatus: ShortcutStatus = { status: "checking" };
const shortcutStatusListeners = new Set<() => void>();

export function publishShortcutStatus(status: ShortcutStatus) {
  currentShortcutStatus = status;
  shortcutStatusListeners.forEach((listener) => listener());
  window.dispatchEvent(
    new CustomEvent(shortcutStatusEvent, { detail: status }),
  );
}

export function useShortcutStatus() {
  return useSyncExternalStore(
    (listener) => {
      shortcutStatusListeners.add(listener);
      return () => shortcutStatusListeners.delete(listener);
    },
    () => currentShortcutStatus,
    () => currentShortcutStatus,
  );
}
