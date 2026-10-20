import { compareTexts } from '/diff.js';
import { readDocxText } from '/docx.js';

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 20 * 1024 * 1024;
const CONTEXT = 2; // unchanged lines kept around each difference in "differences only" mode

const state = { result: null, diffs: [], at: -1 };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

async function loadFile(side, file) {
  showError('');
  if (!file) return;
  if (file.size > MAX_BYTES) return showError(`"${file.name}" is larger than 20 MB.`);
  try {
    let text;
    if (/\.docx$/i.test(file.name)) text = await readDocxText(await file.arrayBuffer());
    else if (/\.(pdf|doc|xlsx?|pptx?|zip|png|jpe?g)$/i.test(file.name)) throw new Error(`"${file.name}" isn't supported yet — use .docx, .txt, .md, .csv, .json or paste text.`);
    else text = await file.text();
    $(`text-${side}`).value = text;
    $(`name-${side}`).textContent = file.name;
    if ($('text-a').value && $('text-b').value) run();
  } catch (err) {
    showError(err.message);
  }
}

// ---------- rendering ----------
function parts(container, list, keep) {
  for (const p of list) {
    if (!keep(p.t)) continue;
    container.append(p.t === 'eq' ? document.createTextNode(p.text) : el('mark', p.t, p.text));
  }
}

function splitRow(r) {
  const row = el('div', `row ${r.type}`);
  const L = (n, c, t) => { const x = el('div', `${n} L`, t); if (c) x.classList.add(c); return x; };
  const R = (n, c, t) => { const x = el('div', `${n} R`, t); if (c) x.classList.add(c); return x; };
  const lEmpty = !r.a, rEmpty = !r.b;
  const lc = r.type === 'changed' ? 'chg-l' : '', rc = r.type === 'changed' ? 'chg-r' : '';
  row.append(L('no', '', r.a?.no ?? ''), L('mk', '', r.type === 'removed' || r.type === 'changed' ? '−' : ''));
  const lt = L('tx', lEmpty ? 'empty' : lc);
  if (r.type === 'changed') parts(lt, r.parts, (t) => t !== 'ins'); else if (r.a) lt.textContent = r.a.text;
  row.append(lt, R('no', '', r.b?.no ?? ''), R('mk', '', r.type === 'added' || r.type === 'changed' ? '+' : ''));
  const rt = R('tx', rEmpty ? 'empty' : rc);
  if (r.type === 'changed') parts(rt, r.parts, (t) => t !== 'del'); else if (r.b) rt.textContent = r.b.text;
  row.append(rt);
  return row;
}

function inlineRow(r) {
  const row = el('div', `row ${r.type}`);
  const cls = { removed: 'inl-removed', added: 'inl-added', changed: 'inl-changed', same: '' }[r.type];
  const tx = el('div', `tx ${cls}`);
  if (r.type === 'changed') parts(tx, r.parts, () => true);
  else tx.textContent = (r.a || r.b).text;
  row.append(el('div', 'no', r.a?.no ?? ''), el('div', 'no', r.b?.no ?? ''), el('div', 'mk', { removed: '−', added: '+', changed: '±', same: '' }[r.type]), tx);
  return row;
}

function render() {
  const { rows } = state.result;
  const inline = document.querySelector('input[name=view]:checked').value === 'inline';
  const onlyDiff = $('only-diff').checked;
  const diff = $('diff');
  diff.replaceChildren();
  diff.classList.toggle('inline', inline);
  state.diffs = [];

  // Which rows to show; unchanged runs collapse to a "N unchanged lines" button when asked.
  const show = rows.map((r) => !onlyDiff || r.type !== 'same');
  if (onlyDiff) rows.forEach((r, i) => { if (r.type !== 'same') for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) show[j] = true; });

  const frag = document.createDocumentFragment();
  for (let i = 0; i < rows.length; i++) {
    if (!show[i]) {
      let j = i; while (j < rows.length && !show[j]) j++;
      const hidden = rows.slice(i, j);
      const b = el('button', 'fold', `⋯ ${hidden.length} unchanged line${hidden.length === 1 ? '' : 's'} — click to show`);
      b.type = 'button';
      b.addEventListener('click', () => { $('only-diff').checked = false; render(); });
      frag.append(b); i = j - 1; continue;
    }
    const r = rows[i];
    const node = inline ? inlineRow(r) : splitRow(r);
    if (r.type !== 'same') state.diffs.push(node); // one stop per differing line
    frag.append(node);
  }
  diff.append(frag);
  state.at = -1;
  updatePos();
}

function updatePos() {
  const n = state.diffs.length;
  $('pos').textContent = n ? (state.at < 0 ? `${n} difference${n === 1 ? '' : 's'}` : `${state.at + 1} of ${n}`) : '';
  $('prev').disabled = $('next').disabled = n === 0;
}

function go(delta) {
  const n = state.diffs.length;
  if (!n) return;
  state.diffs[state.at]?.classList.remove('current');
  state.at = state.at < 0 ? (delta > 0 ? 0 : n - 1) : (state.at + delta + n) % n;
  const node = state.diffs[state.at];
  node.classList.add('current');
  node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  updatePos();
}

function renderStats(s) {
  const box = $('stats');
  box.replaceChildren(el('span', 'chip', `${s.similarity}% identical`));
  if (s.identical) return;
  box.append(el('span', 'chip add', `+ ${s.added} added`), el('span', 'chip del', `− ${s.removed} removed`), el('span', 'chip chg', `± ${s.changed} changed`));
}

function run() {
  showError('');
  const a = $('text-a').value, b = $('text-b').value;
  if (!a && !b) return showError('Add some text or a file on at least one side.');
  state.result = compareTexts(a, b, { ignoreWhitespace: $('opt-ws').checked, ignoreCase: $('opt-case').checked });
  $('results').hidden = false;
  renderStats(state.result.stats);
  if (state.result.stats.identical) {
    state.diffs = []; state.at = -1;
    $('diff').replaceChildren(el('div', 'identical', '✓ The two documents are identical.'));
    updatePos();
  } else render();
}

// ---------- wiring ----------
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
for (const s of ['a', 'b']) {
  $(`file-${s}`).addEventListener('change', (e) => { loadFile(s, e.target.files[0]); e.target.value = ''; });
  const pane = $(`text-${s}`).closest('.pane');
  pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drag'); });
  pane.addEventListener('dragleave', () => pane.classList.remove('drag'));
  pane.addEventListener('drop', (e) => { e.preventDefault(); pane.classList.remove('drag'); loadFile(s, e.dataTransfer.files[0]); });
  $(`text-${s}`).addEventListener('input', () => { $(`name-${s}`).textContent = 'Pasted text'; });
}
$('swap').addEventListener('click', () => {
  const [ta, tb, na, nb] = ['text-a', 'text-b', 'name-a', 'name-b'].map($);
  [ta.value, tb.value] = [tb.value, ta.value];
  [na.textContent, nb.textContent] = [nb.textContent, na.textContent];
  if (state.result) run();
});
$('clear').addEventListener('click', () => {
  for (const s of ['a', 'b']) { $(`text-${s}`).value = ''; $(`name-${s}`).textContent = 'Drop a file here, or paste text'; }
  $('results').hidden = true; state.result = null; showError('');
});
document.querySelectorAll('input[name=view]').forEach((r) => r.addEventListener('change', () => state.result && !state.result.stats.identical && render()));
$('only-diff').addEventListener('change', () => state.result && !state.result.stats.identical && render());
for (const id of ['opt-ws', 'opt-case']) $(id).addEventListener('change', () => state.result && run());
$('next').addEventListener('click', () => go(1));
$('prev').addEventListener('click', () => go(-1));
