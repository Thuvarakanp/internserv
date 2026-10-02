import { HttpError } from '../errors.js';

// Policy: which services may be restarted at all.
export class RestartPolicy {
  #allow;
  constructor(allowlist = null) { this.#allow = allowlist; }
  canRestart(svc) {
    if (svc.protected) return false;
    return this.#allow ? this.#allow.has(svc.name) : true;
  }
  reason(svc) {
    if (svc.protected) return 'This service is protected and cannot be restarted from this tool.';
    if (this.#allow && !this.#allow.has(svc.name)) return 'This service is not on the restart allowlist.';
    return null;
  }
}

// Command object for "restart": validates, rate-limits, audits, executes.
export class ServiceActions {
  #provider; #monitor; #audit; #policy; #cooldownMs; #now; #last = new Map();

  constructor({ provider, monitor, audit, policy, cooldownMs = 30_000, now = Date.now }) {
    this.#provider = provider; this.#monitor = monitor; this.#audit = audit;
    this.#policy = policy; this.#cooldownMs = cooldownMs; this.#now = now;
  }

  canRestart(svc) { return this.#policy.canRestart(svc); }

  async restart(name, actor, ip) {
    const svc = this.#monitor.get(name);
    if (!svc) throw new HttpError(404, 'not_found', `Service "${name}" not found.`);

    const base = { actor: actor.username, role: actor.role, action: 'restart', target: name, ip };
    const deny = (status, code, message, extra) => {
      this.#audit.record({ ...base, result: 'denied', detail: message });
      throw new HttpError(status, code, message, extra);
    };

    const reason = this.#policy.reason(svc);
    if (reason) deny(403, 'not_restartable', reason);
    if (svc.status === 'restarting') deny(409, 'already_restarting', 'Service is already restarting.');

    const since = this.#now() - (this.#last.get(name) ?? -Infinity);
    if (since < this.#cooldownMs) {
      const retryAfter = Math.ceil((this.#cooldownMs - since) / 1000);
      deny(429, 'cooldown', `Restarted recently. Try again in ${retryAfter}s.`, { retryAfter });
    }

    this.#last.set(name, this.#now());
    try {
      await this.#provider.restart(name);
    } catch (err) {
      this.#audit.record({ ...base, result: 'error', detail: err.message });
      throw new HttpError(502, 'restart_failed', `Restart failed: ${err.message}`);
    }
    this.#audit.record({ ...base, result: 'accepted', detail: `was ${svc.status}` });
    await this.#monitor.poll(); // reflect "restarting" right away
    return { name, accepted: true };
  }
}
