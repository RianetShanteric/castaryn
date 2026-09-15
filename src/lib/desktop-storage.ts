import { invoke, isTauri } from "@tauri-apps/api/core";
import type { StateStorage } from "zustand/middleware";

const browserFallbackKey = "castaryn-local-profile-v1";
const legacyBrowserFallbackKey = "elyvo-local-profile-v1";
export const storageStatusEvent = "castaryn-storage-status";
export type StorageStatus = "saving" | "saved" | "error";

let lastPersistedValue: string | null | undefined;

function reportStatus(status: StorageStatus) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StorageStatus>(storageStatusEvent, { detail: status }),
  );
}

function getBrowserStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export const desktopStorage: StateStorage<Promise<void>> = {
  async getItem(name) {
    if (isTauri()) {
      const value = await invoke<string | null>("load_app_state");
      lastPersistedValue = value;
      return value;
    }

    const storage = getBrowserStorage();
    const key = name ?? browserFallbackKey;
    let value = storage?.getItem(key) ?? null;
    if (value === null && storage) {
      const legacyValue = storage.getItem(legacyBrowserFallbackKey);
      if (legacyValue !== null) {
        storage.setItem(key, legacyValue);
        storage.removeItem(legacyBrowserFallbackKey);
        value = legacyValue;
      }
    }
    lastPersistedValue = value;
    return value;
  },

  async setItem(name, value) {
    if (lastPersistedValue === value) return;
    reportStatus("saving");
    try {
      if (isTauri()) {
        await invoke("save_app_state", { payload: value });
      } else {
        const storage = getBrowserStorage();
        storage?.setItem(name ?? browserFallbackKey, value);
        storage?.removeItem(legacyBrowserFallbackKey);
      }
      lastPersistedValue = value;
      reportStatus("saved");
    } catch (error) {
      reportStatus("error");
      throw error;
    }
  },

  async removeItem(name) {
    if (isTauri()) {
      await invoke("clear_app_state");
    } else {
      const storage = getBrowserStorage();
      storage?.removeItem(name ?? browserFallbackKey);
      storage?.removeItem(legacyBrowserFallbackKey);
    }
    lastPersistedValue = null;
    reportStatus("saved");
  },
};
