// Pure diff engine (no DOM) so it runs in the browser and in node tests.
// Line-level Myers diff, then a word-level diff inside lines that were edited.

export function myers(a, b) {
  const n = a.length, m = b.length, max = n + m, off = max;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  let D = 0;
  search: for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d, off + d + 1)); // state after round d-1, indexed by k + d
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { D = d; break search; }
    }
  }
  const ops = [];
  let x = n, y = m;
  for (let d = D; d > 0; d--) {
    const prev = trace[d], k = x - y;
    const prevK = (k === -d || (k !== d && prev[k - 1 + d] < prev[k + 1 + d])) ? k + 1 : k - 1;
    const prevX = prev[prevK + d], prevY = prevX - prevK;
    const midX = prevK === k + 1 ? prevX : prevX + 1;
    const midY = prevK === k + 1 ? prevY + 1 : prevY;
    while (x > midX && y > midY) { x--; y--; ops.push({ t: 'eq', a: x, b: y }); }
    if (prevK === k + 1) { y--; ops.push({ t: 'ins', b: y }); } else { x--; ops.push({ t: 'del', a: x }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ t: 'eq', a: x, b: y }); }
  return ops.reverse();
}

const splitLines = (t) => (t === '' ? [] : t.replace(/\r\n?/g, '\n').split('\n'));
const WORD = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const tokens = (s) => s.match(WORD) || [];
const lineKey = (o) => (s) => {
  if (o.ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim();
  return o.ignoreCase ? s.toLowerCase() : s;
};
const tokenKey = (o) => (s) => {
  if (/^\s+$/.test(s)) return o.ignoreWhitespace ? ' ' : s;
  return o.ignoreCase ? s.toLowerCase() : s;
};

// Word-level diff of two lines -> [{ t: 'eq'|'del'|'ins', text }], plus a similarity ratio.
export function wordDiff(aLine, bLine, opts = {}) {
  const ta = tokens(aLine), tb = tokens(bLine), key = tokenKey(opts);
  const ops = myers(ta.map(key), tb.map(key));
  const parts = [];
  let same = 0;
  for (const op of ops) {
    const text = op.t === 'ins' ? tb[op.b] : ta[op.a];
    if (op.t === 'eq' && !/^\s+$/.test(text)) same++;
    const last = parts[parts.length - 1];
    if (last && last.t === op.t) last.text += text; else parts.push({ t: op.t, text });
  }
  const words = (t) => t.filter((s) => !/^\s+$/.test(s)).length;
  const denom = Math.max(words(ta), words(tb));
  return { parts, similarity: denom ? same / denom : 1 };
}

const SIMILAR = 0.4; // below this a pair of edited lines is shown as remove + add, not an in-line edit

// Returns { rows, stats }. A row is one of:
//   { type: 'same',    a: { no, text }, b: { no, text } }
//   { type: 'changed', a, b, parts }   // parts = word-level diff
//   { type: 'removed', a }  |  { type: 'added', b }
export function compareTexts(aText, bText, opts = {}) {
  const A = splitLines(aText), B = splitLines(bText), key = lineKey(opts);
  const ops = myers(A.map(key), B.map(key));
  const rows = [];
  const side = (arr, i) => ({ no: i + 1, text: arr[i] });
  const flush = (dels, inss) => {
    const pairs = Math.min(dels.length, inss.length);
    const removed = [], added = [];
    for (let i = 0; i < pairs; i++) {
      const { parts, similarity } = wordDiff(A[dels[i]], B[inss[i]], opts);
      if (similarity >= SIMILAR) rows.push({ type: 'changed', a: side(A, dels[i]), b: side(B, inss[i]), parts, similarity });
      else { removed.push(dels[i]); added.push(inss[i]); }
    }
    // keep source order: an unpaired block is emitted as removals then additions
    const delRest = [...removed, ...dels.slice(pairs)], insRest = [...added, ...inss.slice(pairs)];
    for (const i of delRest) rows.push({ type: 'removed', a: side(A, i) });
    for (const i of insRest) rows.push({ type: 'added', b: side(B, i) });
  };
  let dels = [], inss = [];
  for (const op of ops) {
    if (op.t === 'del') dels.push(op.a);
    else if (op.t === 'ins') inss.push(op.b);
    else {
      if (dels.length || inss.length) { flush(dels, inss); dels = []; inss = []; }
      rows.push({ type: 'same', a: side(A, op.a), b: side(B, op.b) });
    }
  }
  if (dels.length || inss.length) flush(dels, inss);

  const count = (t) => rows.filter((r) => r.type === t).length;
  const same = count('same'), longest = Math.max(A.length, B.length);
  const partial = rows.reduce((n, r) => n + (r.type === 'changed' ? r.similarity : 0), 0); // lightly edited lines count partly
  const stats = {
    same, changed: count('changed'), added: count('added'), removed: count('removed'),
    linesA: A.length, linesB: B.length,
    similarity: longest ? Math.round(((same + partial) / longest) * 100) : 100,
  };
  stats.identical = stats.changed + stats.added + stats.removed === 0;
  return { rows, stats };
}
