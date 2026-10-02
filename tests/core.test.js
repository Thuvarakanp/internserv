import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { summarize } from '../src/services/monitor.js';
import { parseSystemctl, SystemdProvider } from '../src/providers/systemd.js';
import { DockerProvider } from '../src/providers/docker.js';

const op = { username: 'o', role: 'operator' };

test('monitor snapshot lists all mock services with summary', async () => {
  const { monitor } = build();
  await monitor.poll();
  const s = monitor.snapshot();
  assert.equal(s.services.length, 17);
  assert.equal(s.summary.total, 17);
  assert.equal(s.summary.overall, 'degraded'); // search degraded + failed legacy
});

test('restart: mock service goes restarting -> running and emits change events', async () => {
  const { monitor, actions, clock } = build();
  await monitor.poll();
  const changes = [];
  monitor.on('change', (e) => changes.push(`${e.name}:${e.from}>${e.to}`));
  await actions.restart('redis-cache', op, '1.1.1.1');
  assert.equal(monitor.get('redis-cache').status, 'restarting');
  clock.t += 3500;
  await monitor.poll();
  assert.equal(monitor.get('redis-cache').status, 'running');
  assert.equal(monitor.get('redis-cache').restartCount, 1);
  assert.deepEqual(changes, ['redis-cache:running>restarting', 'redis-cache:restarting>running']);
});

test('restart: flaky legacy service fails on first restart, works on second', async () => {
  const { monitor, actions, clock } = build({ cooldownMs: 0 });
  await monitor.poll();
  await actions.restart('legacy-sftp', op, 'ip'); clock.t += 3500; await monitor.poll();
  assert.equal(monitor.get('legacy-sftp').status, 'failed');
  await actions.restart('legacy-sftp', op, 'ip'); clock.t += 3500; await monitor.poll();
  assert.equal(monitor.get('legacy-sftp').status, 'running');
});

test('restart: protected, unknown, in-progress and cooldown are rejected and audited', async () => {
  const { monitor, actions, audit, clock } = build();
  await monitor.poll();
  await assert.rejects(actions.restart('postgres-primary', op, 'ip'), { status: 403, code: 'not_restartable' });
  await assert.rejects(actions.restart('nope', op, 'ip'), { status: 404 });
  await actions.restart('nginx', op, 'ip');
  await assert.rejects(actions.restart('nginx', op, 'ip'), { status: 409 });
  clock.t += 3500; await monitor.poll();
  await assert.rejects(actions.restart('nginx', op, 'ip'), { status: 429, code: 'cooldown' });
  clock.t += 30_000;
  await actions.restart('nginx', op, 'ip');
  const results = audit.list().map((e) => e.result);
  assert.deepEqual(results.filter((r) => r === 'denied').length, 3);
  assert.equal(results.filter((r) => r === 'accepted').length, 2);
});

test('restart: allowlist limits which services can be restarted', async () => {
  const { monitor, actions } = build({ allowlist: new Set(['nginx']) });
  await monitor.poll();
  await assert.rejects(actions.restart('redis-cache', op, 'ip'), { status: 403 });
  assert.deepEqual(await actions.restart('nginx', op, 'ip'), { name: 'nginx', accepted: true });
});

test('auth: login, roles, wrong password, rate limit, expiry', () => {
  const { auth, clock } = build();
  const { token, user } = auth.login('o', 'pw', 'ip');
  assert.equal(user.role, 'operator');
  assert.equal(auth.authenticate(token).username, 'o');
  assert.ok(auth.constructor.can(user, 'viewer') && !auth.constructor.can(user, 'admin'));
  for (let i = 0; i < 5; i++) assert.throws(() => auth.login('o', 'bad', 'x'), { status: 401 });
  assert.throws(() => auth.login('o', 'pw', 'x'), { status: 429 });
  clock.t += 9 * 3600_000;
  assert.equal(auth.authenticate(token), null);
});

test('summarize: critical service down => outage', () => {
  assert.equal(summarize([{ status: 'running' }]).overall, 'operational');
  assert.equal(summarize([{ status: 'degraded' }]).overall, 'degraded');
  assert.equal(summarize([{ status: 'failed', critical: true }]).overall, 'outage');
});

test('systemd provider parses units and validates names before exec', async () => {
  const out = [
    'nginx.service loaded active running A high performance web server',
    '● bad.service loaded failed failed Broken thing',
    'ghost.service not-found inactive dead ghost.service',
    'sshd.socket loaded active running ignored',
  ].join('\n');
  assert.equal(parseSystemctl(out).length, 2);
  const calls = [];
  const p = new SystemdProvider({ exec: async (c, a) => { calls.push([c, ...a]); return out; } });
  const list = await p.list();
  assert.deepEqual(list.map((s) => [s.name, s.status]), [['nginx', 'running'], ['bad', 'failed']]);
  await p.restart('nginx');
  assert.deepEqual(calls.at(-1), ['systemctl', 'restart', 'nginx.service']);
  await assert.rejects(p.restart('x; rm -rf /'), /Invalid/);
});

test('docker provider maps container states', async () => {
  const rows = [
    { Names: 'web', State: 'running', Status: 'Up 2 hours', Image: 'nginx' },
    { Names: 'job', State: 'exited', Status: 'Exited (1) 3 minutes ago', Image: 'job' },
    { Names: 'old', State: 'exited', Status: 'Exited (0) 1 day ago', Image: 'old' },
  ].map((r) => JSON.stringify(r)).join('\n');
  const p = new DockerProvider({ exec: async () => rows });
  assert.deepEqual((await p.list()).map((s) => s.status), ['running', 'failed', 'stopped']);
});

test('config: test account exists in mock mode only', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig({}).users['Test@tester.com'].role, 'operator');
  assert.equal(loadConfig({ PROVIDER: 'docker', USERS_JSON: '{}' }).users['Test@tester.com'], undefined);
  assert.throws(() => loadConfig({ PROVIDER: 'docker' }), /USERS_JSON/);
  assert.equal(loadConfig({ PROVIDER: 'docker', AUTH_MODE: 'proxy' }).authMode, 'proxy'); // no local users needed with SSO
});
