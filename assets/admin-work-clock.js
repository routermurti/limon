export const ACTIVITY_CHECK_MIN_MS = 30 * 60 * 1000;
export const ACTIVITY_CHECK_MAX_MS = 60 * 60 * 1000;
export const ACTIVITY_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
export const DEVICE_SLEEP_DRIFT_MS = 15 * 1000;

export function randomActivityCheckDelay(random = Math.random) {
  const sample = Number(random());
  const bounded = Number.isFinite(sample)
    ? Math.min(0.999999999, Math.max(0, sample))
    : 0.5;
  return ACTIVITY_CHECK_MIN_MS + Math.floor(
    bounded * (ACTIVITY_CHECK_MAX_MS - ACTIVITY_CHECK_MIN_MS + 1)
  );
}

/** Advance a local work clock. Hidden-tab elapsed time counts; clock/suspend
 * discontinuities pause rather than silently inflating the saved work total. */
export function advanceWorkClock(state, nowPerf, nowWall) {
  const lastPerf = Number.isFinite(state.lastPerf) ? state.lastPerf : nowPerf;
  const lastWall = Number.isFinite(state.lastWall) ? state.lastWall : nowWall;
  const perfDelta = Math.max(0, nowPerf - lastPerf);
  const wallDelta = Math.max(0, nowWall - lastWall);
  const next = {
    ...state,
    lastPerf: nowPerf,
    lastWall: nowWall,
    autoPauseReason: null
  };

  if (!state.running && !state.inBreak) return next;

  if (Math.abs(perfDelta - wallDelta) > DEVICE_SLEEP_DRIFT_MS) {
    next.running = false;
    next.inBreak = false;
    next.activityCheckDeadline = null;
    next.autoPauseReason = 'device-suspend';
    return next;
  }

  let elapsed = Math.min(perfDelta, wallDelta);
  if (state.running && Number.isFinite(state.activityCheckDeadline) && nowWall >= state.activityCheckDeadline) {
    elapsed = Math.min(elapsed, Math.max(0, state.activityCheckDeadline - lastWall));
    next.running = false;
    next.inBreak = false;
    next.activityCheckDeadline = null;
    next.autoPauseReason = 'check-timeout';
  }

  if (state.running) next.workMs = (Number(state.workMs) || 0) + elapsed;
  if (state.inBreak) next.breakMs = (Number(state.breakMs) || 0) + elapsed;
  return next;
}
