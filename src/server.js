import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';
import { AuthService } from './services/auth.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, headers = {}) {
  if (res.req.headers['x-forwarded-proto'] === 'https') headers = { 'Strict-Transport-Security': 'max-age=31536000', ...headers };
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...HEADERS, ...(isObj ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 10_000) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Request body too large.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new HttpError(400, 'bad_json', 'Invalid JSON body.'); }
}

export function createServer({ config, monitor, auth, actions, audit }) {
  const requireUser = (req, minRole = 'viewer') => {
    const user = auth.fromRequest(req);
    if (!user) throw new HttpError(401, 'unauthenticated', auth.mode === 'proxy' ? 'Not signed in via SSO.' : 'Please sign in.');
    if (!AuthService.can(user, minRole)) throw new HttpError(403, 'forbidden', `Requires ${minRole} role.`);
    return { user, token: /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] };
  };

  const decorate = (svc, user) => ({ ...svc, restartable: actions.canRestart(svc) && AuthService.can(user, 'operator') });

  async function api(req, res, url) {
    const { pathname: p, searchParams: q } = url;
    const ip = req.socket.remoteAddress;
    auth.checkCsrf(req);

    if (req.method === 'GET' && p === '/api/health') {
      return send(res, 200, { ok: true, provider: monitor.providerName, mock: config.mock, authMode: auth.mode, demoHint: config.mock && auth.mode === 'local' ? 'Demo accounts: viewer / operator / admin (password: <role>123)' : null });
    }
    if (req.method === 'POST' && p === '/api/login') {
      if (auth.mode !== 'local') throw new HttpError(404, 'not_found', 'Sign-in is handled by your SSO proxy.');
      const { username, password } = await readJson(req);
      return send(res, 200, auth.login(username, password, ip));
    }
    if (req.method === 'POST' && p === '/api/logout') {
      const { token } = requireUser(req); auth.logout?.(token);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/me') return send(res, 200, requireUser(req).user);

    if (req.method === 'GET' && p === '/api/services') {
      const { user } = requireUser(req);
      const snap = monitor.snapshot();
      return send(res, 200, { ...snap, services: snap.services.map((s) => decorate(s, user)) });
    }
    let m = /^\/api\/services\/([^/]+)$/.exec(p);
    if (req.method === 'GET' && m) {
      const { user } = requireUser(req);
      const name = decodeURIComponent(m[1]);
      const svc = monitor.get(name);
      if (!svc) throw new HttpError(404, 'not_found', `Service "${name}" not found.`);
      return send(res, 200, { ...decorate(svc, user), events: monitor.events(20, name) });
    }
    m = /^\/api\/services\/([^/]+)\/restart$/.exec(p);
    if (req.method === 'POST' && m) {
      const { user } = requireUser(req, 'operator');
      return send(res, 202, await actions.restart(decodeURIComponent(m[1]), user, ip));
    }
    if (req.method === 'GET' && p === '/api/events') {
      requireUser(req);
      return send(res, 200, { events: monitor.events(Math.min(Number(q.get('limit')) || 50, 200)) });
    }
    if (req.method === 'GET' && p === '/api/audit') {
      requireUser(req, 'admin');
      return send(res, 200, { entries: audit.list(Math.min(Number(q.get('limit')) || 100, 500)) });
    }
    throw new HttpError(404, 'not_found', 'Unknown API route.');
  }

  async function serveStatic(res, pathname) {
    const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    const file = join(PUBLIC_DIR, rel);
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(403, 'forbidden', 'Forbidden.');
    try {
      const data = await readFile(file);
      send(res, 200, data, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    } catch {
      throw new HttpError(404, 'not_found', 'Not found.');
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') await serveStatic(res, url.pathname);
      else throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    } catch (err) {
      if (err instanceof HttpError) {
        const headers = err.extra.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : {};
        return send(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } }, headers);
      }
      console.error(err);
      send(res, 500, { error: { code: 'internal', message: 'Internal server error.' } });
    }
  });
}
