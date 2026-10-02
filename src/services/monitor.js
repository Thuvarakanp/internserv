import { EventEmitter } from 'node:events';

const ALARM = new Set(['failed']);

// Polls a provider, keeps short history per service, and emits a 'change'
// event whenever a service's status transitions (Observer pattern).
export class Monitor extends EventEmitter {
  #provider; #pollMs; #historySize; #now; #timer = null;
  #services = new Map(); #history = new Map(); #events = [];
  #updatedAt = null; #lastError = null;

  constructor({ provider, pollMs = 3000, historySize = 40, now = Date.now }) {
    super();
    this.#provider = provider; this.#pollMs = pollMs; this.#historySize = historySize; this.#now = now;
  }

  get providerName() { return this.#provider.name; }

  async poll() {
    let list;
    try {
      list = await this.#provider.list();
      this.#lastError = null;
    } catch (err) {
      this.#lastError = err.message;
      return;
    }
    const at = new Date(this.#now()).toISOString();
    const seen = new Set();
    for (const svc of list) {
      seen.add(svc.name);
      const prev = this.#services.get(svc.name);
      if (prev && prev.status !== svc.status) {
        const evt = { at, name: svc.name, label: svc.label, from: prev.status, to: svc.status, severity: ALARM.has(svc.status) ? 'error' : svc.status === 'running' ? 'ok' : 'warn' };
        this.#events.unshift(evt);
        if (this.#events.length > 200) this.#events.pop();
        this.emit('change', evt);
      }
      const h = this.#history.get(svc.name) || [];
      h.push({ t: at, status: svc.status, latencyMs: svc.latencyMs });
      if (h.length > this.#historySize) h.shift();
      this.#history.set(svc.name, h);
      this.#services.set(svc.name, svc);
    }
    for (const name of [...this.#services.keys()]) {
      if (!seen.has(name)) { this.#services.delete(name); this.#history.delete(name); }
    }
    this.#updatedAt = at;
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.poll(), this.#pollMs);
    this.#timer.unref?.();
  }
  stop() { clearInterval(this.#timer); this.#timer = null; }

  get(name) {
    const svc = this.#services.get(name);
    return svc ? { ...svc, history: this.#history.get(name) || [] } : null;
  }

  events(limit = 50, name) {
    const list = name ? this.#events.filter((e) => e.name === name) : this.#events;
    return list.slice(0, limit);
  }

  snapshot() {
    const services = [...this.#services.values()].map((s) => ({
      ...s,
      history: (this.#history.get(s.name) || []).map((p) => p.latencyMs),
    }));
    return { services, summary: summarize(services), updatedAt: this.#updatedAt, stale: this.#lastError !== null, error: this.#lastError, provider: this.providerName };
  }
}

export function summarize(services) {
  const counts = { total: services.length, running: 0, degraded: 0, failed: 0, stopped: 0, restarting: 0 };
  for (const s of services) counts[s.status] = (counts[s.status] || 0) + 1;
  const criticalDown = services.some((s) => s.critical && (s.status === 'failed' || s.status === 'stopped'));
  let overall = 'operational';
  if (counts.degraded || counts.failed || counts.restarting) overall = 'degraded';
  if (criticalDown) overall = 'outage';
  return { ...counts, overall };
}
