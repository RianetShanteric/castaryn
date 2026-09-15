// Mirrors the bound enforced by validate_bounded_u64(..., 604_800) in src-tauri/src/database.rs
// for activeRun.elapsedSeconds and dungeon.durationSeconds — exceeding it fails save_app_state.
export const MAX_TRACKED_RUN_SECONDS = 604_800;

export function elapsedSecondsSince(startedAtMs: number, nowMs = Date.now()) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return Math.min(elapsed, MAX_TRACKED_RUN_SECONDS);
}
