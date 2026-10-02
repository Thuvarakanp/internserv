# Service Monitor

Internal tool to see whether server-side services are up, how they're doing, and restart them safely.
Zero npm dependencies (Node ≥ 20). Ships with a **mock provider** so you can try everything without a real server.

```bash
npm start            # http://127.0.0.1:3000  (mock data)
npm test             # 13 tests (node:test)
```

Demo logins (mock mode only): `viewer / viewer123`, `operator / operator123`, `admin / admin123`.

## Features
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
| Dependency injection | clock/RNG/exec are injected, so tests are deterministic and never touch real services |

Adding a provider (e.g. pm2, Kubernetes): create `src/providers/<name>.js` returning the normalized service shape (see `mock.js`) and register it in the factory.

## Security notes
Restart runs without a shell (`execFile` with an argument array) and names are validated; only allowlisted, non-protected services can be restarted; every attempt (including denials) is audited; passwords are scrypt-hashed, logins are rate-limited; the UI renders server data with `textContent` and a strict CSP. Sessions are in memory (restart = sign in again).
For production: serve over HTTPS, replace `USERS_JSON` with your SSO, and review the allowlist.

See [docs/PROMPTS.md](docs/PROMPTS.md) for the prompt library used to build and extend this.
