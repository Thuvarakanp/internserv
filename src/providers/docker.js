import { run, SAFE_NAME } from './exec.js';

const STATE = { running: 'running', restarting: 'restarting', paused: 'degraded', exited: 'stopped', created: 'stopped', dead: 'failed' };

export function parseDockerPs(out) {
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

export class DockerProvider {
  #exec;
  constructor({ exec = run } = {}) { this.#exec = exec; }
  get name() { return 'docker'; }

  async list() {
    const out = await this.#exec('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}']);
    return parseDockerPs(out).map((c) => {
      let status = STATE[c.State] || 'stopped';
      if (status === 'stopped' && /Exited \((?!0\))/.test(c.Status || '')) status = 'failed';
      return {
        name: c.Names, label: c.Names, group: c.Image || 'docker', critical: false, protected: false,
        status, latencyMs: null, cpu: null, memMb: null, pid: null, port: null, version: c.Image || null,
        uptimeSec: null, restartCount: null, since: null, detail: c.Status || '',
      };
    });
  }

  async restart(name) {
    if (!SAFE_NAME.test(name)) throw new Error('Invalid container name');
    await this.#exec('docker', ['restart', name]);
  }
}
