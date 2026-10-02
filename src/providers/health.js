import net from 'node:net';
import { readFileSync } from 'node:fs';

// Probes: each resolves { ok, latencyMs, reason }. Never throws.
export async function httpProbe({ url, expectStatus = 200, timeoutMs = 2000 }, fetchImpl = fetch) {
  const t0 = performance.now();
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const latencyMs = Math.round(performance.now() - t0);
    const ok = Array.isArray(expectStatus) ? expectStatus.includes(res.status) : res.status === expectStatus;
    return { ok, latencyMs, reason: ok ? '' : `HTTP ${res.status} (expected ${expectStatus})` };
  } catch (e) {
    return { ok: false, latencyMs: null, reason: e.name === 'TimeoutError' ? `Timed out after ${timeoutMs}ms` : `Request failed: ${e.cause?.code || e.message}` };
  }
}

export function tcpProbe({ host = '127.0.0.1', port, timeoutMs = 2000 }, connect = net.connect) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = connect({ host, port });
    const done = (ok, reason) => { sock.destroy(); resolve({ ok, latencyMs: ok ? Math.round(performance.now() - t0) : null, reason }); };
    sock.setTimeout(timeoutMs, () => done(false, `Timed out after ${timeoutMs}ms`));
    sock.once('connect', () => done(true, ''));
    sock.once('error', (e) => done(false, `Connection failed: ${e.code || e.message}`));
  });
}

const PROBES = { http: httpProbe, tcp: tcpProbe };

export function loadHealthConfig(file) {
  if (!file) return {};
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`Invalid health config ${file}: ${e.message}`); }
  for (const [name, c] of Object.entries(raw)) {
    if (!PROBES[c.type]) throw new Error(`Health config "${name}": type must be http or tcp`);
    if (c.type === 'http' && !/^https?:\/\//.test(c.url || '')) throw new Error(`Health config "${name}": url must be http(s)`);
    if (c.type === 'tcp' && !Number.isInteger(c.port)) throw new Error(`Health config "${name}": port must be an integer`);
  }
  return raw;
}

// Decorator: wraps any provider and downgrades a "running" service to
// "degraded" when its health check fails `failureThreshold` times in a row.
export class HealthCheckedProvider {
  #inner; #checks; #threshold; #fails = new Map(); #probes;

  constructor(inner, checks, { failureThreshold = 2, probes = PROBES } = {}) {
    this.#inner = inner; this.#checks = checks; this.#threshold = failureThreshold; this.#probes = probes;
  }
  get name() { return this.#inner.name; }
  restart(name) { this.#fails.delete(name); return this.#inner.restart(name); }

  async list() {
    const services = await this.#inner.list();
    return Promise.all(services.map(async (s) => {
      const cfg = this.#checks[s.name];
      if (!cfg || s.status !== 'running') { this.#fails.delete(s.name); return cfg ? { ...s, checked: false } : s; }
      const r = await this.#probes[cfg.type](cfg);
      if (r.ok) { this.#fails.delete(s.name); return { ...s, latencyMs: r.latencyMs ?? s.latencyMs, checked: true }; }
      const n = (this.#fails.get(s.name) || 0) + 1;
      this.#fails.set(s.name, n);
      if (n < this.#threshold) return { ...s, checked: true };
      return { ...s, status: 'degraded', detail: `Health check failing: ${r.reason}`, checked: true };
    }));
  }
}
