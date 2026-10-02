import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { HealthCheckedProvider, httpProbe, tcpProbe, loadHealthConfig } from '../src/providers/health.js';
import { ProxyAuth } from '../src/services/proxyauth.js';
import { createServer } from '../src/server.js';
import { build } from './helpers.js';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('http probe: ok, wrong status, refused, timeout', async () => {
  const srv = http.createServer((req, res) => { if (req.url === '/slow') return; res.statusCode = req.url === '/bad' ? 503 : 200; res.end('x'); });
  const port = await listen(srv);
  assert.equal((await httpProbe({ url: `http://127.0.0.1:${port}/` })).ok, true);
  const bad = await httpProbe({ url: `http://127.0.0.1:${port}/bad` });
  assert.ok(!bad.ok && /503/.test(bad.reason));
  const slow = await httpProbe({ url: `http://127.0.0.1:${port}/slow`, timeoutMs: 100 });
  assert.ok(!slow.ok && /Timed out/.test(slow.reason));
  srv.closeAllConnections(); srv.close();
  assert.equal((await httpProbe({ url: `http://127.0.0.1:${port}/` })).ok, false);
});

test('tcp probe: open and closed port', async () => {
  const srv = net.createServer((s) => s.end());
  const port = await listen(srv);
  assert.equal((await tcpProbe({ port })).ok, true);
  srv.close();
  assert.equal((await tcpProbe({ port })).ok, false);
});

test('HealthCheckedProvider degrades only after threshold, recovers, skips non-running', async () => {
  const inner = { name: 'fake', restart: async () => {}, list: async () => [{ name: 'a', status: 'running', latencyMs: 1, detail: '' }, { name: 'b', status: 'stopped' }, { name: 'c', status: 'running' }] };
  let ok = false;
  const p = new HealthCheckedProvider(inner, { a: { type: 'x' }, b: { type: 'x' } }, { failureThreshold: 2, probes: { x: async () => ({ ok, latencyMs: 7, reason: 'boom' }) } });
  let [a, b, c] = await p.list();
  assert.equal(a.status, 'running');          // 1st failure tolerated
  [a] = await p.list();
  assert.equal(a.status, 'degraded'); assert.match(a.detail, /boom/);
  assert.equal(b.status, 'stopped'); assert.equal(c.status, 'running');
  ok = true; [a] = await p.list();
  assert.equal(a.status, 'running'); assert.equal(a.latencyMs, 7);
});

test('loadHealthConfig validates', () => {
  assert.deepEqual(loadHealthConfig('/nonexistent.json'), {});
  assert.deepEqual(Object.keys(loadHealthConfig('config/health.example.json')), ['api-gateway', 'redis-cache', 'payment-service']);
});

test('proxy SSO: trusted proxy headers map groups to roles; spoofing rejected; CSRF header required', async (t) => {
  const ctx = build();
  await ctx.monitor.poll();
  const auth = new ProxyAuth({ adminGroups: 'ops-admins', operatorGroups: 'ops', allowedGroups: 'ops,ops-admins,eng', trustedProxies: '127.0.0.1' });
  const server = createServer({ config: { mock: true }, ...ctx, auth });
  const port = await listen(server);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${port}`;
  const h = (user, groups, extra = {}) => ({ 'x-forwarded-user': user, 'x-forwarded-groups': groups, ...extra });

  assert.equal((await fetch(base + '/api/services')).status, 401);
  const me = await (await fetch(base + '/api/me', { headers: h('sam', 'eng') })).json();
  assert.deepEqual(me, { username: 'sam', role: 'viewer' });
  assert.equal((await (await fetch(base + '/api/me', { headers: h('ola', 'ops') })).json()).role, 'operator');
  assert.equal((await (await fetch(base + '/api/me', { headers: h('root', 'ops-admins,eng') })).json()).role, 'admin');
  assert.equal((await fetch(base + '/api/me', { headers: h('x', 'strangers') })).status, 403);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: '{}', headers: { 'x-requested-with': 'service-monitor' } })).status, 404);

  const noCsrf = await fetch(base + '/api/services/nginx/restart', { method: 'POST', headers: h('ola', 'ops') });
  assert.equal(noCsrf.status, 403);
  const ok = await fetch(base + '/api/services/nginx/restart', { method: 'POST', headers: h('ola', 'ops', { 'x-requested-with': 'service-monitor' }) });
  assert.equal(ok.status, 202);
  assert.equal(ctx.audit.list()[0].actor, 'ola');

  // header from an untrusted peer is ignored
  const untrusted = new ProxyAuth({ trustedProxies: '10.9.9.9' });
  assert.equal(untrusted.fromRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-user': 'evil' } }), null);
});
