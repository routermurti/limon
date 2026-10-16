import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const verifyMatch = source.match(/async function verify\s*\(options=\{\}\)\s*\{[\s\S]*?\}\s*async function load/);
const callbackMatch = source.match(/db\.auth\.onAuthStateChange\(\(event,session\)=>\{[\s\S]*?\}\);/);
assert.ok(verifyMatch, 'admin.html verify(options) is present');
assert.ok(callbackMatch, 'admin.html auth-state listener is present');
const verifyCode = verifyMatch[0].replace(/\s*async function load$/, '');

function createHarness({ adminExists = true, userError = null } = {}) {
  const state = { appVisible: true, clearCalls: 0, signedOut: false };
  let authHandler;
  const pendingTimers = [];
  const delay = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));
  const db = {
    auth: {
      onAuthStateChange(callback) { authHandler = callback; },
      async getUser() {
        await delay(30);
        return { data: { user: userError ? null : { id: 'admin', email: 'admin@example.test' } }, error: userError };
      },
      async signOut() { state.signedOut = true; return { error: null }; }
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          await delay(30);
          return { data: adminExists ? { user_id: 'admin' } : null, error: null };
        }
      };
    }
  };
  const context = {
    db,
    authCheckId: 0,
    verifiedUserId: 'admin',
    clearProtectedView() {
      state.clearCalls++;
      state.appVisible = false;
      context.verifiedUserId = null;
    },
    showLogin() { context.clearProtectedView(); },
    showApp() { state.appVisible = true; },
    restorePrivateWorkDraft() {},
    async load() {},
    isCurrent(checkId, userId) { return checkId === context.authCheckId && userId === context.verifiedUserId; },
    msg() {},
    setTimeout(fn) { pendingTimers.push(fn); return pendingTimers.length; },
    Array,
    Promise
  };
  vm.runInNewContext(`${verifyCode}\n${callbackMatch[0]}`, context, { timeout: 1000 });
  assert.equal(typeof authHandler, 'function', 'auth listener registered');
  return { state, pendingTimers, authHandler };
}

async function runRefresh(options) {
  const harness = createHarness(options);
  harness.authHandler('TOKEN_REFRESHED', { user: { id: 'admin' } });
  assert.equal(harness.pendingTimers.length, 1, 'refresh triggers membership verification');
  const verification = harness.pendingTimers.shift()();
  const visibleDuringVerification = harness.state.appVisible;
  await verification;
  return { ...harness.state, visibleDuringVerification };
}

const valid = await runRefresh();
assert.equal(valid.visibleDuringVerification, true, 'panel remains visible during a valid token refresh');
assert.equal(valid.appVisible, true, 'panel remains visible after a valid token refresh');
assert.equal(valid.clearCalls, 0, 'valid refresh does not clear protected UI or in-progress work');

const revoked = await runRefresh({ adminExists: false });
assert.equal(revoked.appVisible, false, 'panel closes when server-side admin membership is revoked');
assert.equal(revoked.signedOut, true, 'revoked account is signed out');

const transient = await runRefresh({ userError: { status: 0, message: 'network unavailable' } });
assert.equal(transient.visibleDuringVerification, true, 'transient verification does not flash the login page');
assert.equal(transient.appVisible, true, 'transient network issue does not force logout');

const expired = await runRefresh({ userError: { status: 401, message: 'invalid token' } });
assert.equal(expired.appVisible, false, 'invalid/expired token closes the protected panel');

const signedOut = createHarness();
signedOut.authHandler('SIGNED_OUT', null);
assert.equal(signedOut.state.appVisible, false, 'explicit sign-out closes the protected panel');

console.log('admin-auth-refresh: 5/5 passed (valid refresh, revoked admin, transient network error, expired token, sign-out)');
