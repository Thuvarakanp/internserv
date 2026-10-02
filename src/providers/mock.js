// Mock provider: simulates a fleet of services with drifting metrics, random
// degradation, and restarts that take a few seconds. Time and randomness are
// injectable so tests are deterministic.

const SEED = [
  { name: 'api-gateway', label: 'API Gateway', group: 'Edge', critical: true, port: 8080, base: 42, version: '4.12.1', status: 'running', up: 9 * 86400 },
  { name: 'nginx', label: 'Nginx Reverse Proxy', group: 'Edge', critical: true, port: 443, base: 8, version: '1.25.4', status: 'running', up: 21 * 86400 },
  { name: 'cdn-sync', label: 'CDN Sync', group: 'Edge', port: 9100, base: 95, version: '2.3.0', status: 'running', up: 3 * 86400 },
  { name: 'auth-service', label: 'Auth Service', group: 'Core', critical: true, port: 8101, base: 55, version: '3.8.2', status: 'running', up: 6 * 86400 },
  { name: 'user-service', label: 'User Service', group: 'Core', port: 8102, base: 61, version: '3.1.0', status: 'running', up: 6 * 86400 },
  { name: 'order-service', label: 'Order Service', group: 'Core', port: 8103, base: 88, version: '5.0.4', status: 'running', up: 2 * 86400 },
  { name: 'payment-service', label: 'Payment Service', group: 'Core', critical: true, port: 8104, base: 120, version: '2.9.7', status: 'running', up: 4 * 86400 },
  { name: 'search-service', label: 'Search Service', group: 'Core', port: 8105, base: 140, version: '1.7.2', status: 'degraded', up: 86400, detail: 'Slow responses from index shard 3' },
  { name: 'postgres-primary', label: 'PostgreSQL Primary', group: 'Data', critical: true, protected: true, port: 5432, base: 4, version: '16.2', status: 'running', up: 48 * 86400 },
  { name: 'redis-cache', label: 'Redis Cache', group: 'Data', critical: true, port: 6379, base: 1, version: '7.2.4', status: 'running', up: 14 * 86400 },
  { name: 'elasticsearch', label: 'Elasticsearch', group: 'Data', port: 9200, base: 35, version: '8.12.0', status: 'running', up: 11 * 86400 },
  { name: 'kafka-broker', label: 'Kafka Broker', group: 'Data', critical: true, protected: true, port: 9092, base: 12, version: '3.6.1', status: 'running', up: 30 * 86400 },
  { name: 'email-worker', label: 'Email Worker', group: 'Workers', base: 210, version: '1.14.0', status: 'running', up: 5 * 86400 },
  { name: 'image-processor', label: 'Image Processor', group: 'Workers', base: 340, version: '2.2.1', status: 'running', up: 7 * 86400 },
  { name: 'cron-scheduler', label: 'Cron Scheduler', group: 'Workers', base: 20, version: '0.9.3', status: 'running', up: 18 * 86400 },
  { name: 'report-generator', label: 'Report Generator', group: 'Workers', base: 600, version: '1.5.0', status: 'stopped', up: 0, detail: 'Stopped by operator' },
  { name: 'legacy-sftp', label: 'Legacy SFTP Bridge', group: 'Legacy', port: 22, base: 150, version: '0.4.9', status: 'failed', up: 0, flakyRestart: true, detail: 'Exit code 1: cannot bind to port 22' },
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export class MockProvider {
  #svcs;
  #last;
  #rng;
  #now;
  #restartDelayMs;

  constructor({ rng = Math.random, now = Date.now, restartDelayMs = 3000 } = {}) {
    this.#rng = rng;
    this.#now = now;
    this.#restartDelayMs = restartDelayMs;
    this.#last = now();
    this.#svcs = SEED.map((s, i) => ({
      ...s,
      pid: 1000 + i * 37,
      restartCount: 0,
      since: new Date(now() - s.up * 1000).toISOString(),
      uptimeSec: s.up,
      latencyMs: null,
      cpu: 0,
      memMb: 0,
      restartingUntil: 0,
      flakyUsed: false,
      detail: s.detail || '',
    }));
    for (const s of this.#svcs) this.#sample(s);
  }

  get name() { return 'mock'; }

  async list() {
    this.#advance();
    return this.#svcs.map((s) => this.#view(s));
  }

  async restart(name) {
    const s = this.#svcs.find((x) => x.name === name);
    if (!s) throw new Error(`Unknown service: ${name}`);
    if (s.status === 'restarting') throw new Error('Service is already restarting');
    s.status = 'restarting';
    s.restartingUntil = this.#now() + this.#restartDelayMs;
    s.since = new Date(this.#now()).toISOString();
    s.detail = 'Restart in progress';
    s.latencyMs = null;
    s.cpu = 0;
  }

  #view(s) {
    const { name, label, group, critical = false, protected: prot = false, status, latencyMs, cpu, memMb, pid, port = null, version, uptimeSec, restartCount, since, detail } = s;
    return { name, label, group, critical, protected: prot, status, latencyMs, cpu, memMb, pid: status === 'running' || status === 'degraded' ? pid : null, port, version, uptimeSec: Math.floor(uptimeSec), restartCount, since, detail };
  }

  #sample(s) {
    const up = s.status === 'running' || s.status === 'degraded';
    if (!up) { s.latencyMs = null; s.cpu = 0; s.memMb = 0; return; }
    const jitter = 0.8 + this.#rng() * 0.6;
    s.latencyMs = Math.round(s.base * jitter * (s.status === 'degraded' ? 6 : 1));
    s.cpu = Math.round(clamp((s.cpu || 15) + (this.#rng() - 0.5) * 12, 2, s.status === 'degraded' ? 96 : 70));
    s.memMb = Math.round(clamp((s.memMb || 300 + this.#rng() * 900) + (this.#rng() - 0.5) * 20, 80, 4096));
  }

  #advance() {
    const now = this.#now();
    const elapsed = Math.max(0, now - this.#last) / 1000;
    this.#last = now;
    for (const s of this.#svcs) {
      if (s.status === 'restarting') {
        if (now >= s.restartingUntil) {
          if (s.flakyRestart && !s.flakyUsed) {
            s.flakyUsed = true;
            s.status = 'failed';
            s.detail = 'Exit code 1: cannot bind to port 22';
          } else {
            s.status = 'running';
            s.detail = '';
            s.uptimeSec = 0;
            s.restartCount += 1;
            s.cpu = 0; s.memMb = 0;
          }
          s.since = new Date(now).toISOString();
        }
      } else if (s.status === 'running') {
        s.uptimeSec += elapsed;
        const r = this.#rng();
        if (r < 0.015) { s.status = 'degraded'; s.detail = 'Elevated response times'; s.since = new Date(now).toISOString(); }
        else if (r < 0.018) { s.status = 'failed'; s.detail = 'Health check failed 3 times'; s.since = new Date(now).toISOString(); }
      } else if (s.status === 'degraded') {
        s.uptimeSec += elapsed;
        const r = this.#rng();
        if (r < 0.2) { s.status = 'running'; s.detail = ''; s.since = new Date(now).toISOString(); }
        else if (r < 0.23) { s.status = 'failed'; s.detail = 'Health check failed 3 times'; s.since = new Date(now).toISOString(); }
      }
      this.#sample(s);
    }
  }
}
