import { HttpError } from '../errors.js';

const norm = (ip = '') => ip.replace(/^::ffff:/, '');
const list = (s) => new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean));

// SSO via a trusted reverse proxy (oauth2-proxy, company gateway, Cloudflare Access...).
// The proxy authenticates the user and forwards identity in headers. Headers are
// honoured ONLY when the TCP peer is a configured trusted proxy, so they can't be spoofed.
export class ProxyAuth {
  constructor({ userHeader = 'x-forwarded-user', groupsHeader = 'x-forwarded-groups', adminGroups = '', operatorGroups = '', allowedGroups = '', trustedProxies = '127.0.0.1,::1' } = {}) {
    this.userHeader = userHeader.toLowerCase(); this.groupsHeader = groupsHeader.toLowerCase();
    this.admin = list(adminGroups); this.operator = list(operatorGroups); this.allowed = list(allowedGroups);
    this.trusted = list(trustedProxies);
    if (!this.admin.size && !this.operator.size) console.warn('ProxyAuth: no admin/operator groups configured, everyone is a viewer');
  }

  get mode() { return 'proxy'; }

  fromRequest(req) {
    if (!this.trusted.has(norm(req.socket.remoteAddress))) return null;
    const username = req.headers[this.userHeader];
    if (!username) return null;
    const groups = list(req.headers[this.groupsHeader]);
    if (this.allowed.size && ![...groups].some((g) => this.allowed.has(g))) {
      throw new HttpError(403, 'not_in_group', 'Your account is not allowed to use this tool.');
    }
    const has = (set) => [...groups].some((g) => set.has(g));
    const role = has(this.admin) ? 'admin' : has(this.operator) ? 'operator' : 'viewer';
    return { username: String(username).slice(0, 128), role };
  }

  // Cookie-authenticated proxies are exposed to CSRF: browsers can't add this header cross-site without a CORS preflight, which we never allow.
  checkCsrf(req) {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    if (req.headers['x-requested-with'] !== 'service-monitor') throw new HttpError(403, 'csrf', 'Missing X-Requested-With header.');
  }
}
