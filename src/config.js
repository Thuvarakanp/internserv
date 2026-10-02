const intEnv = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

// Demo accounts exist ONLY in mock mode. Real providers must supply USERS_JSON.
const DEMO_USERS = {
  viewer: { password: 'viewer123', role: 'viewer' },
  operator: { password: 'operator123', role: 'operator' },
  admin: { password: 'admin123', role: 'admin' },
  'Test@tester.com': { password: '!12@Tester', role: 'operator' },
};

export function loadConfig(env = process.env) {
  const provider = (env.PROVIDER || 'mock').toLowerCase();
  const mock = provider === 'mock';

  const authMode = (env.AUTH_MODE || 'local').toLowerCase();
  if (!['local', 'proxy'].includes(authMode)) throw new Error('AUTH_MODE must be "local" or "proxy"');

  let users = DEMO_USERS;
  if (!mock && authMode === 'local') {
    if (!env.USERS_JSON) {
      throw new Error('USERS_JSON is required when PROVIDER is not "mock" (e.g. {"alice":{"password":"...","role":"admin"}})');
    }
    users = JSON.parse(env.USERS_JSON);
  }

  return {
    provider,
    mock,
    port: intEnv(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    pollMs: intEnv(env.POLL_MS, 3000),
    restartCooldownMs: intEnv(env.RESTART_COOLDOWN_MS, 30_000),
    sessionTtlMs: intEnv(env.SESSION_TTL_MS, 8 * 60 * 60 * 1000),
    auditFile: env.AUDIT_FILE ?? 'data/audit.jsonl',
    // null = every non-protected service may be restarted (mock only).
    restartAllowlist: mock ? null : new Set((env.RESTART_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean)),
    users,
    authMode,
    sso: {
      userHeader: env.SSO_USER_HEADER || 'x-forwarded-user',
      groupsHeader: env.SSO_GROUPS_HEADER || 'x-forwarded-groups',
      adminGroups: env.SSO_ADMIN_GROUPS || '',
      operatorGroups: env.SSO_OPERATOR_GROUPS || '',
      allowedGroups: env.SSO_ALLOWED_GROUPS || '',
      trustedProxies: env.TRUSTED_PROXIES || '127.0.0.1,::1',
    },
    healthConfigFile: env.HEALTH_CONFIG ?? 'config/health.json',
  };
}
