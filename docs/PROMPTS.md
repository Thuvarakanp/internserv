# Prompt library

Reusable prompts for extending this project with an AI coding assistant. Each is written to be self-contained.

## Architecture & patterns
**Add a provider** — "Add a `pm2` provider in `src/providers/pm2.js` implementing `list()` and `restart(name)` like `systemd.js`. Parse `pm2 jlist`, map states to running/degraded/failed/stopped/restarting, validate names with `SAFE_NAME`, inject `exec` for tests, register it in `providers/index.js`, and add unit tests with canned output."

**Design review** — "Review `src/services` for SOLID violations and pattern misuse. Propose the smallest change per finding; don't add abstractions that have no second implementation."

## Real health checks
"Add per-service health checks (HTTP `/health`, TCP port, process) configured in `services.yaml`. A service that is 'running' but failing its check must show as `degraded` with the reason in `detail`. Time out after 2s, never block the poll loop, and add tests with a fake server."

## Alerting
"On `Monitor` 'change' events to `failed`, send a Slack webhook (URL from env). De-duplicate: at most one alert per service per 10 minutes, and send a recovery message. Add tests with an injected clock."

## UI/UX
**Audit** — "Audit `public/` against WCAG 2.2 AA: keyboard order, focus management in dialogs, contrast in light/dark, `aria-live` noise during polling, reduced motion, 320px width. List defects with file:line and fix them."

**Operator experience** — "Add a bulk action: select multiple non-critical services and restart sequentially with a progress summary. Keep confirmation, cooldown and audit semantics per service."

## Security
"Threat-model the restart endpoint (STRIDE). Check command injection, privilege of the process, CSRF/XSS, brute-force, session fixation, audit tampering. Output findings ranked by severity with concrete fixes and tests."

## Testing
"Write failing tests first for: restart during an in-flight restart, provider timing out, monitor recovering from a provider error, session expiry mid-restart. Then make them pass with minimal changes."

## Operations
"Add a Dockerfile (non-root, read-only filesystem, healthcheck on /api/health) and a systemd unit for this app, with the minimal sudoers rule allowing only `systemctl restart` for allowlisted units."
