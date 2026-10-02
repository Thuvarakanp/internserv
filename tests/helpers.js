import { MockProvider } from '../src/providers/mock.js';
import { Monitor } from '../src/services/monitor.js';
import { AuthService } from '../src/services/auth.js';
import { AuditLog } from '../src/services/audit.js';
import { RestartPolicy, ServiceActions } from '../src/services/actions.js';

export function build({ rng = () => 0.5, cooldownMs = 30_000, allowlist = null, clock = { t: Date.now() } } = {}) {
  const now = () => clock.t;
  const provider = new MockProvider({ rng, now, restartDelayMs: 3000 });
  const monitor = new Monitor({ provider, now });
  const audit = new AuditLog({ now });
  const auth = new AuthService({ users: { v: { password: 'pw', role: 'viewer' }, o: { password: 'pw', role: 'operator' }, a: { password: 'pw', role: 'admin' } }, now });
  const actions = new ServiceActions({ provider, monitor, audit, policy: new RestartPolicy(allowlist), cooldownMs, now });
  return { provider, monitor, audit, auth, actions, clock };
}
