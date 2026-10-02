import { run, SAFE_NAME } from './exec.js';

const STATE = { active: 'running', reloading: 'running', activating: 'restarting', deactivating: 'restarting', failed: 'failed', inactive: 'stopped' };

export function parseSystemctl(out) {
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [unit, load, active, sub, ...desc] = line.replace(/^[●*]\s*/, '').split(/\s+/);
    return { unit, load, active, sub, description: desc.join(' ') };
  }).filter((r) => r.unit?.endsWith('.service') && r.load !== 'not-found');
}

export class SystemdProvider {
  #exec;
  constructor({ exec = run } = {}) { this.#exec = exec; }
  get name() { return 'systemd'; }

  async list() {
    const out = await this.#exec('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager']);
    return parseSystemctl(out).map((r) => ({
      name: r.unit.replace(/\.service$/, ''),
      label: r.description || r.unit,
      group: 'systemd',
      critical: false,
      protected: false,
      status: STATE[r.active] || 'stopped',
      latencyMs: null, cpu: null, memMb: null, pid: null, port: null, version: null,
      uptimeSec: null, restartCount: null, since: null,
      detail: r.sub,
    }));
  }

  async restart(name) {
    if (!SAFE_NAME.test(name)) throw new Error('Invalid service name');
    await this.#exec('systemctl', ['restart', `${name}.service`]);
  }
}
