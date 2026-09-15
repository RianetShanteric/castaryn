import { useEffect, useState } from "react";
import {
  fetchCreatorAccess,
  publishOverlayState,
  restoreCreatorLogin,
} from "../lib/creator-client";
import { buildPublicStreamState } from "../domain/public-stream-state";
import { useCastarynStore } from "../store/castaryn-store";

export function CreatorBackgroundSync() {
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => {
    const handleSessionChange = () =>
      setSessionRevision((revision) => revision + 1);
    window.addEventListener(
      "castaryn-creator-session-changed",
      handleSessionChange,
    );
    return () =>
      window.removeEventListener(
        "castaryn-creator-session-changed",
        handleSessionChange,
      );
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let timeout: number | undefined;
    let inFlight = false;
    let pending = false;
    let retryDelay = 1_000;

    void (async () => {
      if (!(await restoreCreatorLogin()) || disposed) return;
      const access = await fetchCreatorAccess();
      const creatorId =
        access.active && access.features.includes("overlay")
          ? access.creatorIdentityId
          : null;
      if (!creatorId || disposed) return;

      const flush = async () => {
        if (disposed || inFlight || !pending) return;
        pending = false;
        inFlight = true;
        try {
          const state = useCastarynStore.getState();
          await publishOverlayState(
            creatorId,
            buildPublicStreamState({
              packs: state.packs,
              activeRun: state.activeRun,
              profile: state.profile,
              dayKey: state.dayKey,
              dailyCategoryOverride: state.dailyCategoryOverride,
            }),
          );
          retryDelay = 1_000;
        } catch {
          pending = true;
          window.clearTimeout(timeout);
          timeout = window.setTimeout(() => void flush(), retryDelay);
          retryDelay = Math.min(30_000, retryDelay * 2);
        } finally {
          inFlight = false;
          if (pending && !timeout) {
            timeout = window.setTimeout(() => {
              timeout = undefined;
              void flush();
            }, 250);
          }
        }
      };

      const publish = () => {
        if (disposed) return;
        pending = true;
        window.clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          timeout = undefined;
          void flush();
        }, 250);
      };

      // The store changes far more often than the overlay-relevant fields
      // do (history, settings, timezone, ...), so subscribing to the raw
      // store would schedule a publish on every unrelated change. Comparing
      // the actual payload we'd send keeps this to real changes only.
      const publicStateSnapshot = () =>
        JSON.stringify(
          buildPublicStreamState({
            packs: useCastarynStore.getState().packs,
            activeRun: useCastarynStore.getState().activeRun,
            profile: useCastarynStore.getState().profile,
            dayKey: useCastarynStore.getState().dayKey,
            dailyCategoryOverride:
              useCastarynStore.getState().dailyCategoryOverride,
          }),
        );
      let lastPublicStateSnapshot = publicStateSnapshot();
      const handleStoreChange = () => {
        const snapshot = publicStateSnapshot();
        if (snapshot === lastPublicStateSnapshot) return;
        lastPublicStateSnapshot = snapshot;
        publish();
      };

      const handleOnline = () => publish();
      window.addEventListener("online", handleOnline);
      publish();
      unsubscribe = useCastarynStore.subscribe(handleStoreChange);
      const originalUnsubscribe = unsubscribe;
      unsubscribe = () => {
        originalUnsubscribe();
        window.removeEventListener("online", handleOnline);
      };
    })().catch(() => undefined);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
    };
  }, [sessionRevision]);

  return null;
}
