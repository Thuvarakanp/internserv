import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { createServer } from '../src/server.js';

let server, base, ctx;
const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
const login = async (u) => (await call('/api/login', { method: 'POST', body: { username: u, password: 'pw' } })).json.token;

before(async () => {
  ctx = build();
  await ctx.monitor.poll();
  server = createServer({ config: { mock: true }, ...ctx });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

test('API requires auth', async () => {
  assert.equal((await call('/api/services')).status, 401);
  assert.equal((await call('/api/health')).status, 200);
});

test('viewer can read but not restart; services are flagged restartable per role', async () => {
  const t = await login('v');
  const list = await call('/api/services', { token: t });
  assert.equal(list.status, 200);
  assert.ok(list.json.services.every((s) => s.restartable === false));
  assert.equal((await call('/api/services/nginx/restart', { method: 'POST', token: t })).status, 403);
});

test('operator can restart; admin-only audit endpoint', async () => {
  const o = await login('o');
  const r = await call('/api/services/nginx/restart', { method: 'POST', token: o });
  assert.equal(r.status, 202);
  const again = await call('/api/services/nginx/restart', { method: 'POST', token: o });
  assert.equal(again.status, 409);
  assert.equal((await call('/api/audit', { token: o })).status, 403);
  const a = await login('a');
  const audit = await call('/api/audit', { token: a });
  assert.equal(audit.json.entries[0].target, 'nginx');
});

test('security: bad login, path traversal, bad JSON, security headers', async () => {
  assert.equal((await call('/api/login', { method: 'POST', body: { username: 'o', password: 'x' } })).status, 401);
  const trav = await fetch(base + '/..%2f..%2fpackage.json');
  assert.ok([403, 404].includes(trav.status));
  const bad = await fetch(base + '/api/login', { method: 'POST', body: '{nope' });
  assert.equal(bad.status, 400);
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
});
