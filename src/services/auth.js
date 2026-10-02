import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors.js';

const RANK = { viewer: 0, operator: 1, admin: 2 };

const hash = (pw, salt) => scryptSync(pw, salt, 32);

export class AuthService {
  #users = new Map(); #sessions = new Map(); #fails = new Map();
  #ttl; #now;

  constructor({ users, sessionTtlMs = 8 * 3600_000, now = Date.now }) {
    this.#ttl = sessionTtlMs; this.#now = now;
    for (const [username, u] of Object.entries(users)) {
      if (!(u.role in RANK)) throw new Error(`Invalid role for ${username}: ${u.role}`);
      const salt = randomBytes(16);
      this.#users.set(username, { role: u.role, salt, hash: hash(u.password, salt) });
    }
  }

  login(username, password, ip = 'unknown') {
    const recent = (this.#fails.get(ip) || []).filter((t) => this.#now() - t < 60_000);
    if (recent.length >= 5) throw new HttpError(429, 'rate_limited', 'Too many failed logins. Try again in a minute.');
    const u = this.#users.get(String(username));
    // Always hash so a wrong username takes as long as a wrong password.
    const salt = u?.salt ?? Buffer.alloc(16);
    const candidate = hash(String(password ?? ''), salt);
    const ok = u && timingSafeEqual(candidate, u.hash);
    if (!ok) {
      recent.push(this.#now());
      this.#fails.set(ip, recent);
      throw new HttpError(401, 'bad_credentials', 'Invalid username or password.');
    }
    this.#fails.delete(ip);
    const token = randomBytes(32).toString('hex');
    this.#sessions.set(token, { username, role: u.role, exp: this.#now() + this.#ttl });
    return { token, user: { username, role: u.role } };
  }

  logout(token) { this.#sessions.delete(token); }

  get mode() { return 'local'; }
  fromRequest(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    return m ? this.authenticate(m[1]) : null;
  }
  checkCsrf() {} // bearer tokens in a header are not sent automatically by browsers

  authenticate(token) {
    const s = this.#sessions.get(token);
    if (!s) return null;
    if (s.exp < this.#now()) { this.#sessions.delete(token); return null; }
    return { username: s.username, role: s.role };
  }

  static can(user, minRole) { return RANK[user.role] >= RANK[minRole]; }
}
