import assert from 'node:assert/strict';
import {
  ACTIVITY_CHECK_MIN_MS,
  ACTIVITY_CHECK_MAX_MS,
  ACTIVITY_CHECK_TIMEOUT_MS,
  advanceWorkClock,
  randomActivityCheckDelay
} from '../assets/admin-work-clock.js';

assert.equal(randomActivityCheckDelay(() => 0), ACTIVITY_CHECK_MIN_MS);
assert.ok(randomActivityCheckDelay(() => 0.999999) <= ACTIVITY_CHECK_MAX_MS);
assert.ok(randomActivityCheckDelay(() => 0.5) >= ACTIVITY_CHECK_MIN_MS);
assert.ok(randomActivityCheckDelay(() => 0.5) <= ACTIVITY_CHECK_MAX_MS);
assert.equal(ACTIVITY_CHECK_TIMEOUT_MS, 10 * 60 * 1000);

const background = advanceWorkClock({
  workMs: 2_000,
  breakMs: 0,
  running: true,
  inBreak: false,
  lastPerf: 1_000,
  lastWall: 5_000,
  activityCheckDeadline: null
}, 61_000, 65_000);
assert.equal(background.running, true, 'tab/background switch does not stop the timer');
assert.equal(background.workMs, 62_000, 'elapsed background time is retained');

const timedOut = advanceWorkClock({
  workMs: 0,
  breakMs: 0,
  running: true,
  inBreak: false,
  lastPerf: 1_000,
  lastWall: 5_000,
  activityCheckDeadline: 15_000
}, 31_000, 35_000);
assert.equal(timedOut.running, false, 'timer pauses after unanswered activity check');
assert.equal(timedOut.workMs, 10_000, 'time beyond the check deadline is not counted');
assert.equal(timedOut.autoPauseReason, 'check-timeout');

const suspended = advanceWorkClock({
  workMs: 4_000,
  breakMs: 0,
  running: true,
  inBreak: false,
  lastPerf: 10_000,
  lastWall: 20_000,
  activityCheckDeadline: null
}, 11_000, 80_000);
assert.equal(suspended.running, false, 'device-suspend/clock discontinuity pauses the timer');
assert.equal(suspended.workMs, 4_000, 'suspend gap does not inflate recorded time');
assert.equal(suspended.autoPauseReason, 'device-suspend');

const breakClock = advanceWorkClock({
  workMs: 4_000,
  breakMs: 1_000,
  running: false,
  inBreak: true,
  lastPerf: 1_000,
  lastWall: 1_000,
  activityCheckDeadline: null
}, 6_000, 6_000);
assert.equal(breakClock.workMs, 4_000);
assert.equal(breakClock.breakMs, 6_000, 'break time is tracked separately');

console.log('admin-work-clock: 5/5 passed (random interval, background continuation, timeout cap, suspend pause, break accounting)');
