// Vanilla-JS dashboard. All dynamic text goes through textContent (via h()) so
// service names/details from the server can never inject markup.

const $ = (id) => document.getElementById(id);
const STATUS = {
  running: { icon: '●', label: 'Running' },
  degraded: { icon: '▲', label: 'Degraded' },
  failed: { icon: '✕', label: 'Failed' },
  stopped: { icon: '■', label: 'Stopped' },
  restarting: { icon: '↻', label: 'Restarting' },
};
const BANNER = {
  operational: ['✔', 'All systems operational'],
  degraded: ['▲', 'Some services need attention'],
  outage: ['✕', 'Critical service outage'],
};

const state = { token: sessionStorage.getItem('token'), user: null, data: null, q: '', status: '', group: '', timer: null, lastOk: 0, failures: 0 };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signedOut(); }
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
  const [icon, text] = BANNER[d.summary.overall];
  const banner = $('banner');
  banner.className = `banner ${d.summary.overall}`;
  banner.replaceChildren(h('span', { 'aria-hidden': 'true' }, icon), text);
  if (d.stale) banner.append(h('span', { class: 'stale' }, `Data source unreachable: ${d.error}`));

  const tiles = [['total', 'Total'], ['running', 'Running'], ['degraded', 'Degraded'], ['failed', 'Failed'], ['stopped', 'Stopped'], ['restarting', 'Restarting']];
  $('tiles').replaceChildren(...tiles.map(([k, l]) => h('div', { class: 'tile' }, h('b', {}, d.summary[k] ?? 0), h('span', {}, l))));

  renderFilters(d);
  renderRows(d);
  $('provider').textContent = `source: ${d.provider}`;
}

function renderFilters(d) {
  const counts = d.summary;
  const opts = [['', 'All', counts.total], ...Object.keys(STATUS).map((s) => [s, STATUS[s].label, counts[s] || 0])];
  $('filters').replaceChildren(...opts.map(([val, label, n]) =>
    h('button', { class: 'fbtn', type: 'button', 'aria-pressed': String(state.status === val), onclick: () => { state.status = val; render(); } }, `${label} ${n}`)));
  const groups = [...new Set(d.services.map((s) => s.group))].sort();
  const sel = $('group');
  if (sel.options.length - 1 !== groups.length) {
    sel.replaceChildren(h('option', { value: '' }, 'All groups'), ...groups.map((g) => h('option', { value: g }, g)));
    sel.value = state.group;
  }
}

function visible() {
  const q = state.q.trim().toLowerCase();
  return state.data.services.filter((s) =>
    (!state.status || s.status === state.status) && (!state.group || s.group === state.group) &&
    (!q || `${s.name} ${s.label} ${s.group}`.toLowerCase().includes(q)));
}

function restartButton(s, opts = {}) {
  const busy = s.status === 'restarting';
  const btn = h('button', {
    class: `btn sm ${opts.primary ? 'primary' : ''}`, type: 'button', 'data-restart': s.name,
    disabled: !s.restartable || busy,
    title: !s.restartable ? (s.protected ? 'Protected service' : 'Restart not permitted for your role / this service') : busy ? 'Restart in progress' : `Restart ${s.name}`,
    'aria-label': `Restart ${s.name}`,
    onclick: (e) => { e.stopPropagation(); askRestart(s); },
  }, busy ? 'Restarting…' : 'Restart');
  return btn;
}

function row(s) {
  const tr = h('tr', { 'data-name': s.name, class: 'clickable' },
    h('td', {}, h('button', { class: 'svc-name', type: 'button', onclick: () => openDetail(s.name) }, s.name),
      s.critical ? h('span', { class: 'tag' }, 'critical') : null, s.protected ? h('span', { class: 'tag' }, '🔒 protected') : null,
      h('span', { class: 'sub' }, s.detail || s.label)),
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
  const next = list.map((s) => {
    const old = existing.get(s.name);
    const fresh = row(s);
    return old && old._sig === fresh._sig ? old : fresh;
  });
  body.replaceChildren(...next);
  if (refocus) body.querySelector(`tr[data-name="${CSS.escape(refocus.name)}"] ${refocus.sel}`)?.focus();
}

function renderEvents(events) {
  const ul = $('events');
  if (!events.length) return ul.replaceChildren(h('li', { class: 'muted' }, 'No status changes yet. They will appear here as services change state.'));
  ul.replaceChildren(...events.map((e) => h('li', {}, h('time', {}, fmtTime(e.at)), h('strong', {}, e.name), badge(e.from), '→', badge(e.to))));
}

function renderAudit(entries) {
  $('audit').replaceChildren(...(entries.length ? entries.map((e) => h('tr', {},
    h('td', {}, fmtTime(e.at)), h('td', {}, `${e.actor} (${e.role})`), h('td', {}, e.action), h('td', {}, e.target), h('td', {}, e.result), h('td', {}, e.detail || '')))
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
    h('h2', { id: 'detail-title' }, svc.label), h('p', { class: 'muted' }, `${svc.name}${svc.detail ? ' — ' + svc.detail : ''}`),
    sparkline(svc.history.map((p) => p.latencyMs), 'big'),
    h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('h2', {}, 'Recent changes'),
    svc.events.length ? h('ul', { class: 'feed' }, svc.events.map((e) => h('li', {}, h('time', {}, fmtTime(e.at)), badge(e.from), '→', badge(e.to)))) : h('p', { class: 'muted' }, 'No changes since the monitor started.'),
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
  if (!state.token) return;
  try {
    state.data = await api('/api/services');
    state.lastOk = Date.now(); state.failures = 0;
    render();
    if (!$('panel-activity').hidden) loadEvents();
    if (!$('panel-audit').hidden) loadAudit();
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
  state.token = null; state.user = null; state.data = null;
  sessionStorage.removeItem('token');
  clearInterval(state.timer);
  $('main').hidden = true; $('logout').hidden = true; $('user').textContent = ''; $('updated').textContent = '';
  if (!$('login').open) $('login').showModal();
}

async function enter() {
  state.user = await api('/api/me');
  $('user').textContent = state.user.username === state.user.role ? state.user.role : `${state.user.username} · ${state.user.role}`;
  $('logout').hidden = false; $('main').hidden = false;
  $('tab-audit').hidden = state.user.role !== 'admin';
  selectTab('services');
  await refresh(); startPolling();
}

function selectTab(name) {
  for (const t of ['services', 'activity', 'audit']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  if (name === 'activity') loadEvents();
  if (name === 'audit') loadAudit();
}

function init() {
  $('q').addEventListener('input', (e) => { state.q = e.target.value; if (state.data) renderRows(state.data); });
  $('group').addEventListener('change', (e) => { state.group = e.target.value; if (state.data) renderRows(state.data); });
  for (const t of ['services', 'activity', 'audit']) $(`tab-${t}`).addEventListener('click', () => selectTab(t));
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

  fetch('/api/health').then((r) => r.json()).then((h) => { $('login-hint').textContent = h.demoHint || ''; $('provider').textContent = `source: ${h.provider}`; }).catch(() => {});
  if (state.token) enter().catch(signedOut); else $('login').showModal();
}
init();
