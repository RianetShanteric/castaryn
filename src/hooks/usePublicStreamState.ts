import { useMemo } from "react";
import { buildPublicStreamState } from "../domain/public-stream-state";
import { useCastarynStore } from "../store/castaryn-store";

export function usePublicStreamState() {
  const packs = useCastarynStore((state) => state.packs);
  const activeRun = useCastarynStore((state) => state.activeRun);
  const profile = useCastarynStore((state) => state.profile);
  const dayKey = useCastarynStore((state) => state.dayKey);
  const dailyCategoryOverride = useCastarynStore(
    (state) => state.dailyCategoryOverride,
  );

  return useMemo(
    () =>
      buildPublicStreamState({
        packs,
        activeRun,
        profile,
        dayKey,
        dailyCategoryOverride,
      }),
    [activeRun, dailyCategoryOverride, dayKey, packs, profile],
  );
}
