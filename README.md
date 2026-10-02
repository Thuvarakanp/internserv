# Service Monitor

Internal tool to see whether server-side services are up, how they're doing, and restart them safely.
Zero npm dependencies (Node ≥ 20). Ships with a **mock provider** so you can try everything without a real server.

```bash
npm start            # http://127.0.0.1:3000  (mock data)
npm test             # 19 tests (node:test)
```

Demo logins (mock mode only): `viewer / viewer123`, `operator / operator123`, `admin / admin123`, and the test account `Test@tester.com` (operator). These are disabled whenever `PROVIDER` is not `mock`.

## Features
- Separate pages: Dashboard (summary, activity, response times), Services (directory with search, filters, restart), Activity, Audit log (admin). Each page has its own address (`#services`, `#activity`, `#audit`)
- Live dashboard: status (running / degraded / failed / stopped / restarting), latency + trend, uptime, CPU/memory, summary tiles and an overall banner
- Search, status filters, group filter; service detail dialog; activity feed of status changes
- **Restart** with confirmation (critical services require typing the name), per-service cooldown, and an admin-only **audit log**
- Roles: `viewer` (read), `operator` (restart), `admin` (restart + audit log)
- Accessible (keyboard, screen-reader labels, status shown by icon + text, not colour alone), responsive, light/dark

## Using real services
```bash
PROVIDER=systemd USERS_JSON='{"alice":{"password":"change-me","role":"admin"}}' \
RESTART_ALLOWLIST=nginx,api-gateway npm start
```
`PROVIDER` is `mock` (default), `systemd` or `docker`. With a real provider **nothing is restartable until it is listed in `RESTART_ALLOWLIST`**, and `USERS_JSON` is mandatory (demo accounts are disabled). Run the app as a user permitted to run `systemctl restart` / `docker restart`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | 3000 / 127.0.0.1 | Listen address (put TLS + a reverse proxy in front before exposing it) |
| `POLL_MS` | 3000 | How often services are checked |
| `RESTART_COOLDOWN_MS` | 30000 | Minimum gap between restarts of one service |
| `SESSION_TTL_MS` | 8h | Login lifetime |
| `AUDIT_FILE` | data/audit.jsonl | Append-only audit trail |

## Real health checks
"Running" only means the process is up. To check that a service actually works, copy `config/health.example.json` to `config/health.json` and list an HTTP or TCP check per service (`HEALTH_CONFIG` overrides the path):
```json
{ "api-gateway": { "type": "http", "url": "http://127.0.0.1:8080/health", "expectStatus": 200, "timeoutMs": 2000 },
  "redis-cache": { "type": "tcp", "host": "127.0.0.1", "port": 6379 } }
```
A running service whose check fails twice in a row is shown as **degraded** with the reason; it recovers automatically. The check's response time replaces the latency column. Checks run in parallel with a timeout, so a hung service can't stall the dashboard.

## Company SSO (trusted proxy)
Put the app behind your SSO gateway (oauth2-proxy, Cloudflare Access, Azure AD App Proxy, nginx `auth_request`...) and start with:
```bash
AUTH_MODE=proxy SSO_ADMIN_GROUPS=ops-admins SSO_OPERATOR_GROUPS=ops SSO_ALLOWED_GROUPS=ops,ops-admins,eng \
TRUSTED_PROXIES=10.0.0.5 PROVIDER=systemd RESTART_ALLOWLIST=nginx npm start
```
The proxy authenticates users and sends `X-Forwarded-User` and `X-Forwarded-Groups` (names configurable via `SSO_USER_HEADER` / `SSO_GROUPS_HEADER`). Admin group → admin, operator group → operator, anyone else allowed → viewer; users outside `SSO_ALLOWED_GROUPS` get 403. The app has no login page or passwords in this mode. Headers are trusted **only from `TRUSTED_PROXIES`** (default loopback), so they can't be spoofed by other clients, and state-changing requests require an `X-Requested-With` header as CSRF protection. Make sure the proxy strips these headers from incoming client requests and that the app port is not reachable except through it. Terminate HTTPS at the proxy; the app then sends HSTS when it sees `X-Forwarded-Proto: https`.

## Architecture & design patterns
```
public/ (vanilla JS UI) ──HTTP──> src/server.js ──> services/{auth,actions,audit,monitor}
                                                          └──> providers/{mock,systemd,docker}
```
| Pattern | Where |
|---|---|
| Strategy / Adapter | `providers/*` implement `list()` + `restart(name)`; swap with `PROVIDER=` |
| Factory | `providers/index.js` |
| Observer | `Monitor` emits `change` events (feeds the activity log and console) |
| Command + Policy | `ServiceActions.restart` validates, rate-limits, audits, executes; `RestartPolicy` decides what is allowed |
| Decorator | `HealthCheckedProvider` wraps any provider to add health checks |
| Strategy (auth) | `AuthService` (local logins) and `ProxyAuth` (SSO) share `fromRequest()` |
| Dependency injection | clock/RNG/exec are injected, so tests are deterministic and never touch real services |

Adding a provider (e.g. pm2, Kubernetes): create `src/providers/<name>.js` returning the normalized service shape (see `mock.js`) and register it in the factory.

## Security notes
Restart runs without a shell (`execFile` with an argument array) and names are validated; only allowlisted, non-protected services can be restarted; every attempt (including denials) is audited; passwords are scrypt-hashed, logins are rate-limited; the UI renders server data with `textContent` and a strict CSP. Sessions are in memory (restart = sign in again).
For production: use `AUTH_MODE=proxy` behind HTTPS and review the allowlist.

See [docs/PROMPTS.md](docs/PROMPTS.md) for the prompt library used to build and extend this.
