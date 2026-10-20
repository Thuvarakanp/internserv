// Minimal .docx text extractor: reads word/document.xml out of the zip, no dependencies.
const MAX_XML = 50 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// One line per paragraph. Tracked deletions (<w:delText>) are ignored.
export function docxXmlToText(xml) {
  const lines = [];
  for (const [para] of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    let line = '';
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
      line += m[1] !== undefined ? decode(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readDocxText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new Error('This does not look like a valid .docx file.');

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (name === 'word/document.xml') {
      if (usize > MAX_XML) throw new Error('This document is too large to compare in the browser.');
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = bytes.subarray(start, start + csize);
      const xml = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
      if (!xml) throw bad();
      return docxXmlToText(new TextDecoder().decode(xml));
    }
    p += 46 + nlen + elen + clen;
  }
  throw bad();
}
