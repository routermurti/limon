import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20261017050200_limon_security_audit_rpc.sql', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../test-panel.html', import.meta.url), 'utf8');

test('source migration is transactional, idempotent, and restricts RPC execution', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.limon_is_admin\(\)[\s\S]*?RETURNS boolean[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.limon_security_audit\(\)[\s\S]*?RETURNS jsonb[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.limon_is_admin\(\) FROM PUBLIC, anon;/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.limon_security_audit\(\) FROM PUBLIC, anon;/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.limon_is_admin\(\) TO authenticated;/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.limon_security_audit\(\) TO authenticated;/i);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
});

test('security audit RPC denies unauthenticated/non-admin callers and returns only metadata', () => {
  assert.match(migration, /IF auth\.uid\(\) IS NULL OR NOT public\.limon_is_admin\(\) THEN[\s\S]*?ERRCODE = '42501'/i);
  for (const field of ['rls', 'policies', 'grants', 'indexes', 'checked_at']) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /information_schema\.role_table_grants/);
  assert.match(migration, /pg_catalog\.pg_policies/);
  assert.match(migration, /pg_catalog\.pg_indexes/);
});

test('anonymous RPC errors distinguish permission denial from missing functions', () => {
  const match = panel.match(/function classifyRpcError\(error\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'test panel must define classifyRpcError');
  const classifyRpcError = new Function(`return (${match[0]})`)();
  assert.equal(classifyRpcError({ code: '42501', message: 'permission denied' }), 'denied');
  assert.equal(classifyRpcError({ code: 'PGRST202', message: 'not in schema cache' }), 'missing');
  assert.equal(classifyRpcError({ code: '42883', message: 'function does not exist' }), 'missing');
  assert.equal(classifyRpcError({ code: '401', message: 'invalid API key' }), 'unknown');
});

test('test panel checks authenticated admin RPCs and anonymous denial/private tables', () => {
  assert.match(panel, /db\.rpc\('limon_is_admin'\)/);
  assert.match(panel, /db\.rpc\('limon_security_audit'\)/);
  assert.match(panel, /anonDb\.rpc\('limon_is_admin'\)/);
  assert.match(panel, /anonDb\.rpc\('limon_security_audit'\)/);
  for (const table of ['limon_admins', 'limon_pre_registrations', 'limon_signup_limits', 'limon_orders', 'limon_work_sessions', 'limon_finance_entries']) {
    assert.ok(panel.includes(`'${table}'`), `test panel should include ${table}`);
  }
});

test('test panel revalidates administrator rights after token refresh and hides on auth changes', () => {
  assert.match(panel, /event==='TOKEN_REFRESHED'[\s\S]*?revalidateAdminAfterRefresh/);
  assert.match(panel, /onAuthStateChange\([\s\S]*?hideDashboard/);
});
