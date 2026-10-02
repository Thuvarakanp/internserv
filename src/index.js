import { loadConfig } from './config.js';
import { createProvider } from './providers/index.js';
import { Monitor } from './services/monitor.js';
import { AuthService } from './services/auth.js';
import { AuditLog } from './services/audit.js';
import { RestartPolicy, ServiceActions } from './services/actions.js';
import { createServer } from './server.js';
import { ProxyAuth } from './services/proxyauth.js';
import { HealthCheckedProvider, loadHealthConfig } from './providers/health.js';

const config = loadConfig();
const base = createProvider(config.provider);
const checks = loadHealthConfig(config.healthConfigFile);
const provider = Object.keys(checks).length ? new HealthCheckedProvider(base, checks) : base;
if (Object.keys(checks).length) console.log(`Health checks enabled for ${Object.keys(checks).length} service(s)`);
const monitor = new Monitor({ provider, pollMs: config.pollMs });
const audit = new AuditLog({ file: config.auditFile });
const auth = config.authMode === 'proxy' ? new ProxyAuth(config.sso) : new AuthService({ users: config.users, sessionTtlMs: config.sessionTtlMs });
const actions = new ServiceActions({ provider, monitor, audit, policy: new RestartPolicy(config.restartAllowlist), cooldownMs: config.restartCooldownMs });

monitor.on('change', (e) => console.log(`[${e.at}] ${e.name}: ${e.from} -> ${e.to}`));
await monitor.poll();
monitor.start();

createServer({ config, monitor, auth, actions, audit }).listen(config.port, config.host, () => {
  console.log(`Service Monitor (${config.provider}) on http://${config.host}:${config.port}`);
});
