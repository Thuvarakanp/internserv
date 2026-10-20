import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { compareTexts, wordDiff, myers } from '../public/diff.js';
import { readDocxText, docxXmlToText } from '../public/docx.js';

const types = (r) => r.rows.map((x) => x.type);

test('myers reconstructs both sequences', () => {
  const a = 'abcabba'.split(''), b = 'cbabac'.split('');
  const ops = myers(a, b);
  assert.equal(ops.filter((o) => o.t !== 'ins').map((o) => a[o.a]).join(''), a.join(''));
  assert.equal(ops.filter((o) => o.t !== 'del').map((o) => b[o.b]).join(''), b.join(''));
  assert.equal(ops.filter((o) => o.t !== 'eq').length, 5); // minimal edit distance for this classic pair
});

test('identical documents', () => {
  const r = compareTexts('one\ntwo\nthree', 'one\ntwo\nthree');
  assert.ok(r.stats.identical);
  assert.equal(r.stats.similarity, 100);
});

test('added, removed and changed lines are classified', () => {
  const r = compareTexts('alpha\nthe quick brown fox\ngamma', 'alpha\nthe quick red fox\ngamma\ndelta');
  assert.deepEqual(types(r), ['same', 'changed', 'same', 'added']);
  const ch = r.rows[1];
  assert.deepEqual(ch.parts.filter((p) => p.t !== 'eq').map((p) => [p.t, p.text]), [['del', 'brown'], ['ins', 'red']]);
  assert.deepEqual(r.stats, { ...r.stats, same: 2, changed: 1, added: 1, removed: 0 });
});

test('dissimilar edited lines become remove + add, not an in-line edit', () => {
  const r = compareTexts('hello there', 'completely different text');
  assert.deepEqual(types(r), ['removed', 'added']);
});

test('ignore whitespace and case', () => {
  const a = 'Hello   World\nfoo', b = 'hello world\nfoo';
  assert.equal(compareTexts(a, b).stats.identical, false);
  assert.ok(compareTexts(a, b, { ignoreWhitespace: true, ignoreCase: true }).stats.identical);
  assert.equal(compareTexts('a  b', 'a b', { ignoreWhitespace: true }).stats.identical, true);
});

test('handles empty inputs and CRLF', () => {
  assert.ok(compareTexts('', '').stats.identical);
  assert.deepEqual(types(compareTexts('', 'x')), ['added']);
  assert.ok(compareTexts('a\r\nb', 'a\nb').stats.identical);
});

test('wordDiff keeps punctuation tokens', () => {
  const { parts } = wordDiff('price: 10,00', 'price: 12,00');
  assert.deepEqual(parts.filter((p) => p.t !== 'eq').map((p) => p.text), ['10', '12']);
});

test('large documents diff quickly', () => {
  const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`), b = [...a];
  b[100] = 'changed line'; b.splice(2500, 1); b.push('tail');
  const t = Date.now();
  const r = compareTexts(a.join('\n'), b.join('\n'));
  assert.ok(Date.now() - t < 2000);
  assert.equal(r.stats.added + r.stats.removed + r.stats.changed > 0, true);
});

// ---- docx ----
function zip(name, content) {
  const data = deflateRawSync(Buffer.from(content)), nm = Buffer.from(name);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(content.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(content.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, nm, data]), central = Buffer.concat([cd, nm]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test('docx paragraphs are extracted', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:pPr/><w:r><w:t xml:space="preserve">Line </w:t></w:r><w:r><w:tab/><w:t>two</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:body></w:document>';
  const buf = zip('word/document.xml', xml);
  assert.equal(await readDocxText(buf), 'Hello & welcome\nLine \ttwo');
  assert.equal(docxXmlToText(xml), 'Hello & welcome\nLine \ttwo');
});

test('non-docx input is rejected', async () => {
  await assert.rejects(readDocxText(new Uint8Array(100)), /valid \.docx/);
});

test('similarity gives partial credit to lightly edited lines', () => {
  const r = compareTexts('a b c d e f g h\nsame', 'a b c d e f g X\nsame');
  assert.ok(r.stats.similarity > 80 && r.stats.similarity < 100);
});
