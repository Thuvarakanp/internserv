// Vanilla-JS dashboard. All dynamic text goes through textContent (via h()) so
// service names/details from the server can never inject markup. Icons are static strings defined here.

const $ = (id) => document.getElementById(id);
const STATUS = {
  running: { icon: '●', label: 'Running', tone: 'ok' },
  degraded: { icon: '▲', label: 'Degraded', tone: 'warn' },
  failed: { icon: '✕', label: 'Failed', tone: 'err' },
  stopped: { icon: '■', label: 'Stopped', tone: 'off' },
  restarting: { icon: '↻', label: 'Restarting', tone: 'busy' },
};
const OVERALL = { operational: ['Operational', 'ok'], degraded: ['Degraded', 'warn'], outage: ['Outage', 'err'] };

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  restart: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><line x1="7" y1="7.5" x2="7.01" y2="7.5"/><line x1="7" y1="16.5" x2="7.01" y2="16.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 15"/><line x1="9" y1="2" x2="15" y2="2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  pause: '<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
};
function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstChild;
}
const STATUS_ICON = { running: 'check', degraded: 'alert', failed: 'x', stopped: 'pause', restarting: 'restart' };

const state = { proxy: false, token: sessionStorage.getItem('token'), user: null, data: null, q: '', status: '', group: '', view: 'dashboard', timer: null, lastOk: 0, failures: 0 };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'service-monitor', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && (state.token || state.proxy)) signedOut();
  if (!res.ok) throw Object.assign(new Error(json.error?.message || `Request failed (${res.status})`), { status: res.status });
  return json;
}

function fmtUptime(s) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 5 ? 'just now' : `${s}s ago`; };
const initials = (s) => s.replace(/[^a-z0-9]+/gi, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const groupClass = (g) => `g${[...g].reduce((a, c) => a + c.charCodeAt(0), 0) % 5}`;

function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  $('toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

function sparkline(points, cls = '') {
  const pts = points.filter((p) => p != null);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `spark ${cls}`);
  svg.setAttribute('viewBox', '0 0 100 30');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', pts.length ? `Latency trend, latest ${pts.at(-1)} ms` : 'No latency data');
  if (pts.length > 1) {
    const max = Math.max(...pts), min = Math.min(...pts), span = max - min || 1;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${27 - ((p - min) / span) * 24}`).join(' '));
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(poly);
  }
  return svg;
}

const badge = (status) => h('span', { class: `badge ${status}` }, h('span', { class: 'ic', 'aria-hidden': 'true' }, STATUS[status]?.icon ?? '?'), STATUS[status]?.label ?? status);

/* ---------- rendering ---------- */

function render() {
  const d = state.data;
  if (!d) return;
  const banner = $('banner');
  banner.hidden = !d.stale;
  banner.textContent = d.stale ? `Data source unreachable: ${d.error}. Showing the last known state.` : '';

  renderKpis(d);
  renderGroups(d);
  renderFilters(d);
  renderRows(d);
  renderRecent(d);
  renderChart(d);
  $('bell-dot').hidden = !d.services.some((s) => s.status === 'failed');
  $('provider').textContent = `source: ${d.provider}`;
}

function kpi(label, value, iconName, foot, pill, tone = 'ok') {
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-top' }, h('div', {}, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value)), h('span', { class: 'kpi-icon' }, icon(iconName))),
    h('div', { class: 'kpi-foot' }, h('span', {}, foot), h('span', { class: `delta ${tone === 'ok' ? '' : tone}` }, pill)));
}

function renderKpis(d) {
  const s = d.summary;
  const [overallLabel, overallTone] = OVERALL[s.overall];
  const live = d.services.filter((x) => x.latencyMs != null);
  const avg = live.length ? Math.round(live.reduce((a, x) => a + x.latencyMs, 0) / live.length) : null;
  const slow = [...live].sort((a, b) => b.latencyMs - a.latencyMs)[0];
  const issues = (s.failed || 0) + (s.degraded || 0);
  const critDown = d.services.filter((x) => x.critical && (x.status === 'failed' || x.status === 'stopped')).length;
  const pct = s.total ? Math.round((s.running / s.total) * 100) : 0;
  $('tiles').replaceChildren(
    kpi('System status', overallLabel, 'pulse', `${s.running} of ${s.total} healthy`, overallTone === 'ok' ? 'All clear' : critDown ? `${critDown} critical down` : 'Needs attention', overallTone),
    kpi('Services running', `${s.running} / ${s.total}`, 'server', `${s.stopped || 0} stopped · ${s.restarting || 0} restarting`, `${pct}%`, pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'err'),
    kpi('Avg response', avg != null ? `${avg} ms` : '—', 'timer', slow ? `Slowest: ${slow.name}` : 'No live services', slow ? `${slow.latencyMs} ms` : '—', slow && slow.latencyMs > 500 ? 'warn' : 'ok'),
    kpi('Open incidents', String(issues), 'alert', `${s.failed || 0} failed · ${s.degraded || 0} degraded`, issues ? (s.failed ? 'Failing' : 'Slow') : 'None', issues ? (s.failed ? 'err' : 'warn') : 'ok'));
}

function renderGroups(d) {
  const groups = ['', ...[...new Set(d.services.map((s) => s.group))].sort()];
  $('groups').replaceChildren(...groups.map((g) =>
    h('button', { type: 'button', 'aria-pressed': String(state.group === g), onclick: () => { state.group = g; render(); } }, g || 'All services')));
}

function renderFilters(d) {
  const counts = d.summary;
  const opts = [['', 'All', counts.total], ...Object.keys(STATUS).map((s) => [s, STATUS[s].label, counts[s] || 0])];
  $('filters').replaceChildren(...opts.map(([val, label, n]) =>
    h('button', { class: 'fbtn', type: 'button', 'aria-pressed': String(state.status === val), onclick: () => { state.status = val; render(); } }, `${label} ${n}`)));
}

function visible() {
  const q = state.q.trim().toLowerCase();
  return state.data.services.filter((s) =>
    (!state.status || s.status === state.status) && (!state.group || s.group === state.group) &&
    (!q || `${s.name} ${s.label} ${s.group}`.toLowerCase().includes(q)));
}

function restartButton(s, opts = {}) {
  const busy = s.status === 'restarting';
  return h('button', {
    class: `btn sm ${opts.primary ? 'primary' : ''}`, type: 'button', 'data-restart': s.name,
    disabled: !s.restartable || busy,
    title: !s.restartable ? (s.protected ? 'Protected service' : 'Restart not permitted for your role / this service') : busy ? 'Restart in progress' : `Restart ${s.name}`,
    'aria-label': `Restart ${s.name}`,
    onclick: (e) => { e.stopPropagation(); askRestart(s); },
  }, icon('restart'), busy ? 'Restarting…' : 'Restart');
}

function row(s) {
  const tr = h('tr', { 'data-name': s.name, class: 'clickable' },
    h('td', {}, h('div', { class: 'svc' },
      h('span', { class: `tile-ic ${groupClass(s.group)}`, 'aria-hidden': 'true' }, initials(s.name)),
      h('div', {}, h('button', { class: 'svc-name', type: 'button', onclick: () => openDetail(s.name) }, s.name),
        s.critical ? h('span', { class: 'tag' }, 'critical') : null, s.protected ? h('span', { class: 'tag' }, 'protected') : null,
        h('span', { class: 'sub-line' }, s.detail || `${s.group} · ${s.label}`)))),
    h('td', {}, badge(s.status)),
    h('td', { class: 'num' }, s.latencyMs != null ? `${s.latencyMs} ms` : '—'),
    h('td', { class: 'hide-sm' }, sparkline(s.history)),
    h('td', { class: 'num hide-sm' }, fmtUptime(s.uptimeSec)),
    h('td', { class: 'num hide-md' }, s.cpu != null && (s.status === 'running' || s.status === 'degraded') ? `${s.cpu}% / ${s.memMb} MB` : '—'),
    h('td', { class: 'num' }, restartButton(s)));
  tr.addEventListener('click', (e) => { if (!e.target.closest('button')) openDetail(s.name); });
  tr._sig = JSON.stringify([s.status, s.detail, s.latencyMs, s.uptimeSec, s.cpu, s.memMb, s.restartable, s.history.at(-1)]);
  return tr;
}

// Keyed update: only rebuild rows whose data changed, so keyboard focus survives polling.
function renderRows(d) {
  const list = visible();
  $('empty').hidden = list.length > 0;
  const body = $('rows');
  const active = document.activeElement;
  const refocus = active?.closest?.('tr[data-name]') ? { name: active.closest('tr').dataset.name, sel: active.matches('[data-restart]') ? '[data-restart]' : '.svc-name' } : null;
  const existing = new Map([...body.children].map((tr) => [tr.dataset.name, tr]));
  body.replaceChildren(...list.map((s) => {
    const old = existing.get(s.name), fresh = row(s);
    return old && old._sig === fresh._sig ? old : fresh;
  }));
  if (refocus) body.querySelector(`tr[data-name="${CSS.escape(refocus.name)}"] ${refocus.sel}`)?.focus();
}

const toneOf = (status) => STATUS[status]?.tone === 'off' ? '' : STATUS[status]?.tone ?? '';

function timelineItem(dotTone, iconName, main, right) {
  return h('li', {}, h('span', { class: `tl-dot ${dotTone}` }, icon(iconName)), h('div', { class: 'tl-main' }, ...main), right);
}

function eventItem(e) {
  return timelineItem(toneOf(e.to), STATUS_ICON[e.to] || 'pulse',
    [h('strong', {}, e.name), h('span', { class: 'tl-trans' }, badge(e.from), '→', badge(e.to))], h('time', {}, fmtTime(e.at)));
}

// Dashboard timeline: latest changes; falls back to services needing attention.
let recentEvents = [];
function renderRecent(d) {
  const ul = $('recent');
  const items = recentEvents.slice(0, 6).map(eventItem);
  if (!items.length) {
    const bad = d.services.filter((s) => s.status === 'failed' || s.status === 'degraded').slice(0, 6);
    bad.forEach((s) => items.push(timelineItem(toneOf(s.status), STATUS_ICON[s.status], [h('strong', {}, s.name), h('span', { class: 'tl-trans' }, s.detail || STATUS[s.status].label)], badge(s.status))));
  }
  ul.replaceChildren(...(items.length ? items : [h('li', { class: 'tl-empty' }, 'All quiet. Status changes will appear here as they happen.')]));
}

function renderChart(d) {
  const live = d.services.filter((s) => s.latencyMs != null).sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 8);
  const avg = live.length ? Math.round(live.reduce((a, s) => a + s.latencyMs, 0) / live.length) : null;
  $('chart-avg').textContent = avg != null ? `${avg} ms` : '—';
  const pill = $('chart-pill');
  pill.textContent = live[0] ? `slowest ${live[0].name}` : 'no data';
  pill.className = `delta ${live[0] && live[0].latencyMs > 500 ? 'warn' : ''}`;
  const max = live[0]?.latencyMs || 1;
  const chart = $('chart');
  chart.setAttribute('aria-label', `Response time of the ${live.length} slowest services: ${live.map((s) => `${s.name} ${s.latencyMs} ms`).join(', ')}`);
  chart.replaceChildren(...live.map((s, i) => {
    const bar = h('div', { class: `bar ${i === 0 ? 'hot' : ''}` });
    bar.style.height = `${Math.max(6, (s.latencyMs / max) * 100)}%`;
    return h('div', { class: 'barcol', title: `${s.name}: ${s.latencyMs} ms` },
      h('div', { class: 'bartrack' }, i === 0 ? h('span', { class: 'bar-tip' }, `${s.latencyMs} ms`) : null, bar),
      h('span', { class: 'barlabel' }, s.name.replace(/-(service|primary|worker|broker|generator|processor|scheduler|cache)$/, '')));
  }));
  // tooltip sits above the hot bar: position it by the bar height
  const tip = chart.querySelector('.bar-tip');
  if (tip) { tip.style.bottom = chart.querySelector('.bar.hot').style.height; tip.style.transform = 'translate(-50%, 0)'; tip.style.marginBottom = '8px'; }
}

function renderEvents(events) {
  recentEvents = events;
  const ul = $('events');
  ul.replaceChildren(...(events.length ? events.map(eventItem) : [h('li', { class: 'tl-empty' }, 'No status changes yet. They will appear here as services change state.')]));
  if (state.data) renderRecent(state.data);
}

function renderAudit(entries) {
  $('audit').replaceChildren(...(entries.length ? entries.map((e) => h('tr', {},
    h('td', {}, fmtTime(e.at)), h('td', {}, `${e.actor} (${e.role})`), h('td', {}, e.action), h('td', {}, e.target),
    h('td', {}, h('span', { class: `delta ${e.result === 'accepted' ? '' : e.result === 'denied' ? 'warn' : 'err'}` }, e.result)), h('td', {}, e.detail || '')))
    : [h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'No actions recorded yet.'))]));
}

/* ---------- dialogs ---------- */

async function openDetail(name) {
  let svc;
  try { svc = await api(`/api/services/${encodeURIComponent(name)}`); } catch (e) { return toast(e.message, 'error'); }
  const dlg = $('detail');
  const rows = [['Status', badge(svc.status)], ['Group', svc.group], ['Version', svc.version ?? '—'], ['Port', svc.port ?? '—'], ['PID', svc.pid ?? '—'],
    ['Uptime', fmtUptime(svc.uptimeSec)], ['Latency', svc.latencyMs != null ? `${svc.latencyMs} ms` : '—'], ['CPU / Memory', svc.cpu != null ? `${svc.cpu}% / ${svc.memMb} MB` : '—'],
    ['Restarts', svc.restartCount ?? '—'], ['Since', svc.since ? new Date(svc.since).toLocaleString() : '—']];
  dlg.replaceChildren(h('div', { class: 'body' },
    h('div', { class: 'svc' }, h('span', { class: `tile-ic ${groupClass(svc.group)}`, 'aria-hidden': 'true' }, initials(svc.name)), h('div', {}, h('h2', { id: 'detail-title' }, svc.label), h('p', { class: 'sub' }, `${svc.name}${svc.detail ? ' · ' + svc.detail : ''}`))),
    sparkline(svc.history.map((p) => p.latencyMs), 'big'),
    h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('h2', {}, 'Recent changes'),
    svc.events.length ? h('ul', { class: 'timeline' }, svc.events.map(eventItem)) : h('p', { class: 'muted' }, 'No changes since the monitor started.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Close'), restartButton(svc, { primary: true }))));
  dlg.showModal();
}

function askRestart(svc) {
  $('detail').open && $('detail').close();
  const dlg = $('confirm'), input = $('confirm-input'), ok = $('confirm-ok');
  $('confirm-title').textContent = `Restart ${svc.name}?`;
  $('confirm-body').textContent = svc.critical
    ? 'This is a CRITICAL service. Restarting it may cause a brief outage for dependent systems.'
    : 'The service will be stopped and started again. Active requests may be interrupted.';
  $('confirm-name').textContent = svc.name;
  $('confirm-type').hidden = !svc.critical;
  input.value = '';
  const check = () => { ok.disabled = svc.critical && input.value !== svc.name; };
  input.oninput = check; check();
  $('confirm-cancel').onclick = () => dlg.close();
  $('confirm-form').onsubmit = async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    ok.disabled = true; ok.textContent = 'Restarting…';
    try {
      await api(`/api/services/${encodeURIComponent(svc.name)}/restart`, { method: 'POST' });
      toast(`Restart requested for ${svc.name}`);
      dlg.close();
      refresh();
    } catch (err) {
      toast(err.message, 'error'); dlg.close();
    } finally { ok.textContent = 'Restart'; }
  };
  dlg.showModal();
  (svc.critical ? input : ok).focus();
}

/* ---------- data + lifecycle ---------- */

async function refresh() {
  if (!state.token && !state.proxy) return;
  try {
    state.data = await api('/api/services');
    state.lastOk = Date.now(); state.failures = 0;
    render();
    loadEvents();
    if (state.view === 'audit') loadAudit();
  } catch (e) {
    if (e.status !== 401) {
      state.failures++;
      if (state.failures === 1) toast('Lost connection to the monitor. Retrying…', 'error');
      if (state.data) { state.data.stale = true; state.data.error = 'cannot reach server'; render(); }
    }
  }
}
const loadEvents = async () => { try { renderEvents((await api('/api/events')).events); } catch {} };
const loadAudit = async () => { try { renderAudit((await api('/api/audit')).entries); } catch {} };

function startPolling() {
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (!document.hidden) refresh(); $('updated').textContent = state.lastOk ? `Updated ${ago(state.lastOk)}` : ''; }, 3000);
}

function signedOut() {
  if (state.proxy) {
    clearInterval(state.timer);
    $('main').hidden = true; $('usercard').hidden = true;
    $('sso-expired').showModal();
    return;
  }
  state.token = null; state.user = null; state.data = null;
  sessionStorage.removeItem('token');
  clearInterval(state.timer);
  $('main').hidden = true; $('usercard').hidden = true; $('updated').textContent = '';
  if (!$('login').open) $('login').showModal();
}

async function enter() {
  state.user = await api('/api/me');
  const name = state.user.username;
  $('user-name').textContent = name; $('user-role').textContent = state.user.role;
  $('avatar-sm').textContent = initials(name.split('@')[0]);
  $('usercard').hidden = false; $('logout').hidden = state.proxy; $('main').hidden = false;
  $('nav-audit').hidden = state.user.role !== 'admin';
  selectView(location.hash.slice(1) || 'dashboard', { updateHash: false });
  await refresh(); startPolling();
}

const VIEWS = ['dashboard', 'services', 'activity', 'audit'];
function selectView(name, { updateHash = true } = {}) {
  if (!VIEWS.includes(name) || (name === 'audit' && state.user?.role !== 'admin')) name = 'dashboard';
  state.view = name;
  if (updateHash) { try { history.replaceState(null, '', name === 'dashboard' ? location.pathname + location.search : `#${name}`); } catch {} }
  for (const v of VIEWS) {
    $(`view-${v}`).hidden = v !== name;
    const b = $(`nav-${v}`);
    if (v === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('groups').hidden = name !== 'services';
  if (name === 'activity') loadEvents();
  if (name === 'audit') loadAudit();
}

function init() {
  const nav = [['dashboard', 'grid', 'Dashboard'], ['services', 'server', 'Services'], ['activity', 'pulse', 'Activity'], ['audit', 'file', 'Audit log']];
  for (const [v, ic, label] of nav) { $(`nav-${v}`).append(icon(ic), label); $(`nav-${v}`).addEventListener('click', () => selectView(v)); }
  $('bell').prepend(icon('bell')); $('bell').addEventListener('click', () => selectView('activity'));
  $('all-activity').addEventListener('click', () => selectView('activity'));
  $('open-services').addEventListener('click', () => selectView('services'));
  addEventListener('hashchange', () => { if (state.user) selectView(location.hash.slice(1) || 'dashboard', { updateHash: false }); });
  $('logout').append(icon('logout'));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; if (state.data) renderRows(state.data); });
  $('logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} signedOut(); });
  $('login').addEventListener('cancel', (e) => e.preventDefault());
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-err').textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: { username: $('lu').value, password: $('lp').value } });
      state.token = r.token; sessionStorage.setItem('token', r.token);
      $('lp').value = ''; $('login').close();
      await enter();
    } catch (err) { $('login-err').textContent = err.message; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  $('sso-reload').addEventListener('click', () => location.reload());
  fetch('/api/health').then((r) => r.json()).then((hl) => {
    state.proxy = hl.authMode === 'proxy';
    $('login-hint').textContent = hl.demoHint || ''; $('provider').textContent = `source: ${hl.provider}`;
    if (state.proxy) enter().catch((e) => { $('sso-msg').textContent = e.message; $('sso-expired').showModal(); });
    else if (state.token) enter().catch(signedOut); else $('login').showModal();
  }).catch(() => toast('Cannot reach the monitor server.', 'error'));
}
init();
