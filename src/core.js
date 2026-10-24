/* 한글(HWP 5.x) 파일 읽기: 복합 파일(CFB) · 배포용 문서 풀기 · 레코드 · 문서 정보 · 본문 구조
 * 공개된 "한글 문서 파일 형식 5.0" 을 바탕으로 직접 작성했어요. */
(function () {
'use strict';
const G = globalThis;

/* ============ 바이트 읽기 도구 ============ */
class BR {
  constructor(u8, pos = 0) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = pos; }
  get len() { return this.u8.length; }
  eof() { return this.p >= this.u8.length; }
  left() { return this.u8.length - this.p; }
  skip(n) { this.p += n; return this; }
  u8_() { const v = this.dv.getUint8(this.p); this.p += 1; return v; }
  i8() { const v = this.dv.getInt8(this.p); this.p += 1; return v; }
  u16() { const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  i32() { const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
  bytes(n) { const v = this.u8.subarray(this.p, this.p + n); this.p += n; return v; }
  // 길이(WORD)가 앞에 붙은 UTF-16 문자열
  str() {
    const n = this.u16(); let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16());
    return s;
  }
}

/* ============ 복합 파일(CFB / OLE2) ============ */
function readCFB(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new Error('한글 파일(.hwp) 형식이 아니에요.');
  const ssz = 1 << dv.getUint16(30, true);
  const msz = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const cutoff = dv.getUint32(56, true);
  const miniStart = dv.getUint32(60, true);
  const nMini = dv.getUint32(64, true);
  let difStart = dv.getUint32(68, true);
  const nDif = dv.getUint32(72, true);
  const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF;
  const secOff = s => (s + 1) * ssz;

  const difat = [];
  for (let i = 0; i < 109; i++) { const s = dv.getUint32(76 + i * 4, true); if (s !== FREE) difat.push(s); }
  for (let k = 0, s = difStart; k < nDif && s < 0xFFFFFFFA; k++) {
    const o = secOff(s);
    for (let i = 0; i < ssz / 4 - 1; i++) { const v = dv.getUint32(o + i * 4, true); if (v !== FREE) difat.push(v); }
    s = dv.getUint32(o + ssz - 4, true);
  }
  const fat = [];
  for (const s of difat.slice(0, nFat)) {
    const o = secOff(s);
    for (let i = 0; i < ssz / 4; i++) fat.push(dv.getUint32(o + i * 4, true));
  }
  const chain = (start, table) => {
    const out = []; let s = start; let guard = 0;
    while (s < 0xFFFFFFFA && guard++ < 1e7) { out.push(s); s = table[s]; if (s === undefined) break; }
    return out;
  };
  const readChain = (start, size) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * ssz);
    secs.forEach((s, i) => { const o = secOff(s); out.set(u8.subarray(o, o + ssz), i * ssz); });
    return size == null ? out : out.subarray(0, size);
  };

  // 디렉터리
  const dirData = readChain(dirStart);
  const ddv = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
  const entries = [];
  for (let i = 0; i < dirData.length / 128; i++) {
    const o = i * 128;
    const nameLen = ddv.getUint16(o + 64, true);
    let name = '';
    for (let k = 0; k < Math.max(0, nameLen / 2 - 1); k++) name += String.fromCharCode(ddv.getUint16(o + k * 2, true));
    entries.push({
      id: i, name, type: dirData[o + 66],
      left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true),
      start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true)
    });
  }
  const root = entries[0];
  // 미니 스트림
  let miniFat = [], miniData = null;
  if (nMini && miniStart < 0xFFFFFFFA) {
    const mf = readChain(miniStart);
    const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true));
    miniData = readChain(root.start, root.size);
  }
  const readStream = e => {
    if (e.size < cutoff && miniData) {
      const secs = chain(e.start, miniFat);
      const out = new Uint8Array(secs.length * msz);
      secs.forEach((s, i) => out.set(miniData.subarray(s * msz, s * msz + msz), i * msz));
      return out.subarray(0, e.size);
    }
    return readChain(e.start, e.size);
  };

  // 경로 -> 항목
  const paths = new Map();
  const walk = (id, prefix) => {
    if (id === 0xFFFFFFFF || id >= entries.length) return;
    const e = entries[id];
    walk(e.left, prefix);
    const p = prefix + e.name;
    paths.set(p, e);
    if (e.type === 1 || e.type === 5) walk(e.child, p + '/');
    walk(e.right, prefix);
  };
  walk(root.child, '');
  return {
    has: p => paths.has(p),
    get: p => { const e = paths.get(p); return e && e.type === 2 ? readStream(e) : null; },
    list: () => [...paths.keys()]
  };
}

/* ============ AES-128 (ECB 복호화만) ============ */
const AES = (() => {
  const sbox = new Uint8Array(256), inv = new Uint8Array(256);
  (function init() {
    let p = 1, q = 1;
    do {
      p = p ^ ((p << 1) & 0xFF) ^ (p & 0x80 ? 0x1B : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF; if (q & 0x80) q ^= 0x09;
      const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
      sbox[p] = (x ^ 0x63) & 0xFF;
    } while (p !== 1);
    sbox[0] = 0x63;
    for (let i = 0; i < 256; i++) inv[sbox[i]] = i;
  })();
  const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = ((a << 1) ^ (a & 0x80 ? 0x11B : 0)) & 0xFF; b >>= 1; } return r; };
  const m9 = new Uint8Array(256), m11 = new Uint8Array(256), m13 = new Uint8Array(256), m14 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { m9[i] = mul(i, 9); m11[i] = mul(i, 11); m13[i] = mul(i, 13); m14[i] = mul(i, 14); }
  function expand(key) {
    const w = new Uint8Array(176); w.set(key.subarray(0, 16));
    let rc = 1;
    for (let i = 16; i < 176; i += 4) {
      let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if (i % 16 === 0) {
        const a = t0; t0 = sbox[t1] ^ rc; t1 = sbox[t2]; t2 = sbox[t3]; t3 = sbox[a];
        rc = ((rc << 1) ^ (rc & 0x80 ? 0x11B : 0)) & 0xFF;
      }
      w[i] = w[i - 16] ^ t0; w[i + 1] = w[i - 15] ^ t1; w[i + 2] = w[i - 14] ^ t2; w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }
  function decryptBlock(w, s) {
    const a = s;
    for (let i = 0; i < 16; i++) a[i] ^= w[160 + i];
    for (let round = 9; round >= 0; round--) {
      // InvShiftRows
      let t = a[13]; a[13] = a[9]; a[9] = a[5]; a[5] = a[1]; a[1] = t;
      t = a[2]; a[2] = a[10]; a[10] = t; t = a[6]; a[6] = a[14]; a[14] = t;
      t = a[3]; a[3] = a[7]; a[7] = a[11]; a[11] = a[15]; a[15] = t;
      for (let i = 0; i < 16; i++) a[i] = inv[a[i]];
      for (let i = 0; i < 16; i++) a[i] ^= w[round * 16 + i];
      if (round > 0) {
        for (let c = 0; c < 16; c += 4) {
          const b0 = a[c], b1 = a[c + 1], b2 = a[c + 2], b3 = a[c + 3];
          a[c] = m14[b0] ^ m11[b1] ^ m13[b2] ^ m9[b3];
          a[c + 1] = m9[b0] ^ m14[b1] ^ m11[b2] ^ m13[b3];
          a[c + 2] = m13[b0] ^ m9[b1] ^ m14[b2] ^ m11[b3];
          a[c + 3] = m11[b0] ^ m13[b1] ^ m9[b2] ^ m14[b3];
        }
      }
    }
  }
  return {
    decryptECB(key, data) {
      const w = expand(key);
      const n = data.length - (data.length % 16);
      const out = new Uint8Array(data.length);
      out.set(data.subarray(0, n));
      for (let i = 0; i < n; i += 16) decryptBlock(w, out.subarray(i, i + 16));
      out.set(data.subarray(n), n);
      return out;
    }
  };
})();

/* ============ 배포용 문서(ViewText) 풀기 ============ */
// 배포용 문서 스트림 = [레코드 머리 4바이트][배포용 데이터 256바이트][AES-128-ECB 로 암호화된 본문]
function decryptViewText(stream) {
  if (stream.length < 260 + 16) throw new Error('배포용 문서 구간이 너무 짧아요.');
  const data = stream.slice(4, 260);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let seed = dv.getUint32(0, true);
  const rand = () => { seed = (Math.imul(seed, 214013) + 2531011) >>> 0; return (seed >>> 16) & 0x7FFF; };
  let value = 0, number = 0;
  for (let i = 0; i < 256; i++) {
    if (number === 0) { value = rand() & 0xFF; number = (rand() & 0xF) + 1; }
    if (i >= 4) data[i] ^= value;
    number--;
  }
  const offset = 4 + (data[0] & 0xF);
  const key = data.subarray(offset, offset + 16);
  return AES.decryptECB(key, stream.subarray(260));
}

/* ============ 압축 풀기 ============ */
function inflateRaw(u8) {
  if (!G.pako) throw new Error('압축 해제 엔진이 없어요.');
  const inf = new G.pako.Inflate({ raw: true });
  inf.push(u8, true);
  if (inf.err && !(inf.result && inf.result.length)) throw new Error('압축을 풀지 못했어요: ' + (inf.msg || inf.err));
  return inf.result;
}

/* ============ 레코드 ============ */
const TAG = {
  DOC_PROPERTIES: 0x10, ID_MAPPINGS: 0x11, BIN_DATA: 0x12, FACE_NAME: 0x13, BORDER_FILL: 0x14, CHAR_SHAPE: 0x15,
  TAB_DEF: 0x16, NUMBERING: 0x17, BULLET: 0x18, PARA_SHAPE: 0x19, STYLE: 0x1A, DISTRIBUTE: 0x1C,
  PARA_HEADER: 0x42, PARA_TEXT: 0x43, PARA_CHAR_SHAPE: 0x44, PARA_LINE_SEG: 0x45, PARA_RANGE_TAG: 0x46,
  CTRL_HEADER: 0x47, LIST_HEADER: 0x48, PAGE_DEF: 0x49, FOOTNOTE_SHAPE: 0x4A, PAGE_BORDER_FILL: 0x4B,
  SHAPE_COMPONENT: 0x4C, TABLE: 0x4D, SC_LINE: 0x4E, SC_RECT: 0x4F, SC_ELLIPSE: 0x50, SC_ARC: 0x51, SC_POLYGON: 0x52,
  SC_CURVE: 0x53, SC_OLE: 0x54, SC_PICTURE: 0x55, SC_CONTAINER: 0x56, CTRL_DATA: 0x57, EQEDIT: 0x58, SC_TEXTART: 0x5A
};
function readRecords(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = []; let p = 0;
  while (p + 4 <= u8.length) {
    const h = dv.getUint32(p, true); p += 4;
    const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF; let size = h >>> 20;
    if (size === 0xFFF) { size = dv.getUint32(p, true); p += 4; }
    if (p + size > u8.length) size = Math.max(0, u8.length - p);
    out.push({ tag, level, data: u8.subarray(p, p + size), children: [] });
    p += size;
  }
  return out;
}
function buildTree(recs) {
  const top = []; const stack = [];
  for (const r of recs) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(r); else top.push(r);
    stack.push(r);
  }
  return top;
}

/* ============ 문서 정보(DocInfo) ============ */
const rgb = c => { const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255; return [r, g, b]; };
// 채우기 정보 (표 칸 · 도형 공통)
function parseFill(b) {
  const f = { color: null, grad: null, img: 0 };
  if (b.left() < 4) return f;
  const type = b.u32();
  if (type === 0) return f;
  if (type & 1) {
    const back = b.u32(); b.u32(); const pt = b.i32();
    if (back !== 0xFFFFFFFF) f.color = rgb(back);
    f.pattern = pt;
  }
  if (type & 4) {
    b.skip(1 + 4 + 4 + 4 + 4);
    const n = b.u32(); const pts = [];
    if (n > 2) for (let i = 0; i < n; i++) pts.push(b.i32());
    const cols = []; for (let i = 0; i < n && b.left() >= 4; i++) cols.push(rgb(b.u32()));
    f.grad = cols; if (!f.color && cols.length) f.color = cols[0];
  }
  if (type & 2) { b.skip(1); b.skip(3); f.img = b.u16(); }
  return f;
}
function parseDocInfo(u8) {
  const info = {
    fonts: [[], [], [], [], [], [], []], charShapes: [], paraShapes: [], borderFills: [], bins: [], numberings: [],
    mappings: [], sectionCount: 1
  };
  const recs = readRecords(u8);
  let fontCounts = null, fontIdx = 0, fontLang = 0, fontInLang = 0;
  for (const r of recs) {
    const b = new BR(r.data);
    switch (r.tag) {
      case TAG.DOC_PROPERTIES: info.sectionCount = b.u16() || 1; break;
      case TAG.ID_MAPPINGS: {
        const arr = []; while (b.left() >= 4) arr.push(b.u32());
        info.mappings = arr; fontCounts = arr.slice(1, 8); break;
      }
      case TAG.BIN_DATA: {
        const attr = b.u16(); const type = attr & 15;
        const o = { type, compress: (attr >> 4) & 3, id: 0, ext: '' };
        if (type === 0) { b.str(); b.str(); } else if (type === 1 || type === 2) { o.id = b.u16(); o.ext = b.str(); }
        info.bins.push(o); break;
      }
      case TAG.FACE_NAME: {
        const attr = b.u8_(); const f = { name: b.str(), alt: '' };
        if (attr & 0x80) { b.skip(1); f.alt = b.str(); }
        while (fontCounts && fontLang < 7 && fontInLang >= fontCounts[fontLang]) { fontLang++; fontInLang = 0; }
        info.fonts[Math.min(fontLang, 6)].push(f); fontInLang++;
        break;
      }
      case TAG.BORDER_FILL: {
        const bf = { attr: b.u16(), sides: [], fill: null };
        for (let i = 0; i < 4; i++) bf.sides.push({ type: b.u8_(), width: b.u8_(), color: rgb(b.u32()) });
        b.skip(6);
        { const fl = parseFill(b); bf.fill = fl.color; bf.grad = fl.grad; bf.img = fl.img; }
        info.borderFills.push(bf); break;
      }
      case TAG.CHAR_SHAPE: {
        const cs = { font: [], ratio: [], spacing: [], rel: [], off: [] };
        for (let i = 0; i < 7; i++) cs.font.push(b.u16());
        for (let i = 0; i < 7; i++) cs.ratio.push(b.u8_());
        for (let i = 0; i < 7; i++) cs.spacing.push(b.i8());
        for (let i = 0; i < 7; i++) cs.rel.push(b.u8_());
        for (let i = 0; i < 7; i++) cs.off.push(b.i8());
        cs.size = b.i32(); cs.attr = b.u32(); b.skip(2);
        cs.color = rgb(b.u32()); cs.ulColor = rgb(b.u32()); b.skip(8);
        cs.italic = !!(cs.attr & 1); cs.bold = !!(cs.attr & 2);
        cs.underline = (cs.attr >> 2) & 3; cs.strike = ((cs.attr >> 18) & 7) !== 0;
        cs.sup = !!(cs.attr & (1 << 15)); cs.sub = !!(cs.attr & (1 << 16));
        info.charShapes.push(cs); break;
      }
      case TAG.PARA_SHAPE: {
        const a1 = b.u32();
        const ps = { align: (a1 >> 2) & 7, marginL: b.i32(), marginR: b.i32(), indent: b.i32(), spaceBefore: b.i32(), spaceAfter: b.i32(), lineSpacing: b.i32() };
        info.paraShapes.push(ps); break;
      }
      default: break;
    }
  }
  return info;
}

/* ============ 본문(Section) ============ */
const ctrlName = v => String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);

function parseCommon(b) {
  const c = {};
  const attr = b.u32();
  c.attr = attr;
  c.inline = !!(attr & 1);
  c.vertRel = (attr >> 3) & 3; c.vertAlign = (attr >> 5) & 7;
  c.horzRel = (attr >> 8) & 3; c.horzAlign = (attr >> 10) & 7;
  c.widthRel = (attr >> 15) & 7; c.heightRel = (attr >> 18) & 3;
  c.wrap = (attr >> 21) & 7; // 0 사각 1 밀착 2 관통 3 위아래 4 글 뒤로 5 글 앞으로
  c.objType = (attr >> 26) & 7;
  c.y = b.i32(); c.x = b.i32(); c.w = b.u32(); c.h = b.u32(); c.z = b.i32();
  c.margin = [b.i16(), b.i16(), b.i16(), b.i16()];
  return c;
}

const EXT_CHARS = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
function parseParagraph(node, ctx) {
  const b = new BR(node.data);
  let nChars = b.u32(); nChars &= 0x7FFFFFFF;
  const mask = b.u32();
  const p = { nChars, paraShape: b.u16(), style: b.u8_(), brk: b.u8_(), items: [], runs: [], lines: [], controls: [], units: 0 };
  const ctrlNodes = [];
  for (const ch of node.children) {
    const d = new BR(ch.data);
    switch (ch.tag) {
      case TAG.PARA_TEXT: {
        let pos = 0;
        while (d.left() >= 2) {
          const c = d.u16();
          if (c >= 32 || c === 0 || c === 10 || c === 13 || (c >= 24 && c <= 31)) {
            p.items.push({ pos, ch: c }); pos += 1;
          } else {
            // 확장/인라인 제어 문자: 8 WCHAR 차지
            const info = d.bytes(Math.min(14, d.left()));
            const o = { pos, ch: c, ext: c, info };
            if (c === 9) { const dv = new DataView(info.buffer, info.byteOffset, info.byteLength); o.tab = info.length >= 4 ? dv.getUint32(0, true) : 0; }
            p.items.push(o); pos += 8;
          }
        }
        p.units = pos; break;
      }
      case TAG.PARA_CHAR_SHAPE: {
        while (d.left() >= 8) p.runs.push({ pos: d.u32(), id: d.u32() });
        break;
      }
      case TAG.PARA_LINE_SEG: {
        while (d.left() >= 36) {
          p.lines.push({ start: d.u32(), y: d.i32(), h: d.i32(), th: d.i32(), base: d.i32(), gap: d.i32(), x: d.i32(), w: d.i32(), tag: d.u32() });
        }
        break;
      }
      case TAG.CTRL_HEADER: ctrlNodes.push(ch); break;
      default: break;
    }
  }
  for (const cn of ctrlNodes) {
    const c = parseControl(cn, ctx);
    p.controls.push(c);
  }
  let ci = 0;
  for (const it of p.items) {
    if (it.ext && EXT_CHARS.has(it.ext)) { it.ctrl = p.controls[ci] || null; ci++; }
  }
  return p;
}

// LIST_HEADER 다음에 오는 문단들을 읽는다 (형제 레코드)
function readParaList(children, i, ctx) {
  const lh = new BR(children[i].data);
  let count = lh.i16(); lh.skip(2); // 문단 수, (예약)
  const attr = lh.u32();
  const paras = [];
  let j = i + 1;
  while (j < children.length && children[j].tag === TAG.PARA_HEADER && (count < 0 || paras.length < count)) {
    paras.push(parseParagraph(children[j], ctx)); j++;
  }
  return { paras, next: j, attr, rest: lh };
}

function parseControl(node, ctx) {
  const b = new BR(node.data);
  const idv = b.u32();
  const id = ctrlName(idv);
  const c = { id, kids: node.children };
  try {
    if (id === 'tbl ') parseTable(c, b, node, ctx);
    else if (id === 'gso ') parseGso(c, b, node, ctx);
    else if (id === 'secd') parseSecd(c, b, node, ctx);
    else if (id === 'cold') {
      const a = b.u16();
      c.count = (a >> 2) & 255; c.same = !!(a & 0x1000); c.gap = b.u16(); c.widths = [];
      if (!c.same) for (let i = 0; i < c.count; i++) c.widths.push(b.u16());
    } else if (id === 'head' || id === 'foot') {
      c.attr = b.u32();
      for (let i = 0; i < node.children.length; i++) {
        if (node.children[i].tag === TAG.LIST_HEADER) { const r = readParaList(node.children, i, ctx); c.paras = r.paras; break; }
      }
    } else if (id === 'eqed') {
      c.common = parseCommon(b);
      for (const ch of node.children) if (ch.tag === TAG.EQEDIT) {
        const d = new BR(ch.data); d.u32(); c.script = d.str(); c.size = d.u32(); c.color = rgb(d.u32()); c.baseline = d.left() >= 2 ? d.i16() : 0;
      }
    } else if (id === 'pgnp') {
      const a = b.u32(); c.pos = (a >> 8) & 15; c.format = a & 255;
    }
  } catch (e) { c.error = String(e && e.message || e); }
  return c;
}

function parseSecd(c, b, node, ctx) {
  for (const ch of node.children) {
    if (ch.tag === TAG.PAGE_DEF) {
      const d = new BR(ch.data);
      c.page = { w: d.u32(), h: d.u32(), l: d.u32(), r: d.u32(), t: d.u32(), b: d.u32(), head: d.u32(), foot: d.u32(), gutter: d.u32(), attr: d.u32() };
    }
  }
}

function parseTable(c, b, node, ctx) {
  c.common = parseCommon(b);
  c.cells = []; c.caption = null;
  const ch = node.children;
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].tag === TAG.TABLE) {
      const d = new BR(ch[i].data);
      c.attr = d.u32(); c.rows = d.u16(); c.cols = d.u16(); c.spacing = d.u16();
      c.pad = [d.u16(), d.u16(), d.u16(), d.u16()];
      c.rowSizes = []; for (let k = 0; k < c.rows; k++) c.rowSizes.push(d.u16());
      c.borderFill = d.u16();
    } else if (ch[i].tag === TAG.LIST_HEADER) {
      const r = readParaList(ch, i, ctx);
      if (c.rows === undefined) { c.caption = r.paras; }
      else {
        const d = r.rest;
        const cell = { attr: r.attr, vAlign: (r.attr >> 5) & 3, paras: r.paras };
        if (d.left() >= 26) {
          cell.col = d.u16(); cell.row = d.u16(); cell.colSpan = d.u16() || 1; cell.rowSpan = d.u16() || 1;
          cell.w = d.u32(); cell.h = d.u32(); cell.pad = [d.u16(), d.u16(), d.u16(), d.u16()];
          cell.borderFill = d.left() >= 2 ? d.u16() : 0;
          c.cells.push(cell);
        }
      }
      i = r.next - 1;
    }
  }
}

function parseGso(c, b, node, ctx) {
  c.common = parseCommon(b);
  c.shape = null;
  for (const ch of node.children) {
    if (ch.tag === TAG.SHAPE_COMPONENT) { c.shape = parseShapeComponent(ch, ctx, 0); break; }
  }
}

function parseShapeComponent(node, ctx, depth) {
  const b = new BR(node.data);
  const s = { kind: 'unknown', kids: [], line: null, fill: null };
  const id1 = b.u32();
  s.cid = ctrlName(id1);
  try {
    const save = b.p;
    if (b.u32() !== id1) b.p = save; // 최상위 구성요소는 ID 가 한 번 더 나온다
    s.offX = b.i32(); s.offY = b.i32(); b.skip(4);
    s.origW = b.u32(); s.origH = b.u32(); s.curW = b.u32(); s.curH = b.u32();
    s.flip = b.u32(); s.rot = b.i16(); b.skip(8);
    const mc = b.u16();
    b.skip(48 * (1 + 2 * mc));
    if (s.cid !== '$con' && b.left() >= 13) {
      const lc = b.u32(), lw = b.i32(), lp = b.u32(); b.u8_();
      s.line = { color: rgb(lc), width: lw, attr: lp, type: lp & 63 };
      s.fill = parseFill(b);
    }
  } catch (e) { s.parseError = String(e && e.message || e); }
  const ch = node.children;
  for (let i = 0; i < ch.length; i++) {
    const r = ch[i]; const d = new BR(r.data);
    switch (r.tag) {
      case TAG.SC_PICTURE: {
        s.kind = 'pic';
        s.border = { color: rgb(d.u32()), width: d.i32(), attr: d.u32() };
        s.pts = []; for (let k = 0; k < 4; k++) s.pts.push([d.i32(), d.i32()]);
        s.crop = [d.i32(), d.i32(), d.i32(), d.i32()];
        d.skip(8 + 3); s.binId = d.u16(); break;
      }
      case TAG.SC_RECT: s.kind = 'rect'; break;
      case TAG.SC_ELLIPSE: s.kind = 'ellipse'; break;
      case TAG.SC_LINE: s.kind = 'line'; s.pt = [d.i32(), d.i32(), d.i32(), d.i32()]; break;
      case TAG.SC_POLYGON: { s.kind = 'poly'; const n = d.i32(); s.poly = []; for (let k = 0; k < n && d.left() >= 8; k++) s.poly.push([d.i32(), d.i32()]); break; }
      case TAG.SC_CURVE: s.kind = 'curve'; break;
      case TAG.SC_ARC: s.kind = 'arc'; break;
      case TAG.SC_OLE: s.kind = 'ole'; break;
      case TAG.SC_CONTAINER: s.kind = 'group'; break;
      case TAG.LIST_HEADER: {
        const rl = readParaList(ch, i, ctx);
        s.text = rl.paras; s.textAttr = rl.attr;
        const q = rl.rest; if (q.left() >= 12) { s.textMargin = [q.u16(), q.u16(), q.u16(), q.u16()]; }
        i = rl.next - 1; break;
      }
      case TAG.SHAPE_COMPONENT: s.kids.push(parseShapeComponent(r, ctx, depth + 1)); break;
      default: break;
    }
  }
  if (s.cid === '$con') s.kind = 'group';
  return s;
}

/* ============ 문서 열기 ============ */
function openHWP(buf) {
  const cfb = readCFB(buf);
  const fh = cfb.get('FileHeader');
  if (!fh) throw new Error('한글 파일 머리 정보(FileHeader)가 없어요.');
  const sig = String.fromCharCode(...fh.subarray(0, 17));
  if (sig !== 'HWP Document File') throw new Error('한글 5.0 이후 형식(.hwp)이 아니에요. (구버전 3.0 형식은 지원하지 않아요)');
  const dv = new DataView(fh.buffer, fh.byteOffset, fh.byteLength);
  const ver = [fh[35], fh[34], fh[33], fh[32]];
  const flags = dv.getUint32(36, true);
  const hdr = { version: ver, compressed: !!(flags & 1), encrypted: !!(flags & 2), distributed: !!(flags & 4), drm: !!(flags & 16), flags };
  if (hdr.encrypted) throw new Error('암호가 걸린 문서예요. 한글에서 암호를 푼 뒤 다시 열어주세요.');
  if (hdr.drm) throw new Error('DRM(문서 보안)이 걸린 문서는 열 수 없어요.');

  const unz = u8 => hdr.compressed ? inflateRaw(u8) : u8;
  const di = cfb.get('DocInfo'); if (!di) throw new Error('문서 정보(DocInfo)가 없어요.');
  const info = parseDocInfo(unz(di));
  info.header = hdr;

  // 그림 등 포함 자료
  info.binMap = new Map();
  info.bins.forEach((bn, idx) => {
    if (bn.type === 0) return;
    const nm = 'BinData/BIN' + bn.id.toString(16).toUpperCase().padStart(4, '0') + '.' + bn.ext;
    let raw = cfb.get(nm);
    if (!raw) { const hit = cfb.list().find(p => p.toLowerCase() === nm.toLowerCase()); if (hit) raw = cfb.get(hit); }
    if (!raw) return;
    let data = raw;
    try { if (bn.compress === 1 || (bn.compress === 0 && hdr.compressed)) data = inflateRaw(raw); } catch (e) { data = raw; }
    const o = { id: bn.id, ext: bn.ext.toLowerCase(), data, index: idx };
    info.binMap.set(bn.id, o);
  });

  const ctx = { info };
  const sections = [];
  for (let i = 0; i < info.sectionCount; i++) {
    let raw;
    if (hdr.distributed) {
      const vt = cfb.get('ViewText/Section' + i);
      if (!vt) throw new Error('배포용 문서의 본문(ViewText/Section' + i + ')을 찾지 못했어요.');
      raw = inflateOrPlain(decryptViewText(vt), hdr.compressed);
    } else {
      const bt = cfb.get('BodyText/Section' + i);
      if (!bt) throw new Error('본문(BodyText/Section' + i + ')을 찾지 못했어요.');
      raw = hdr.compressed ? inflateRaw(bt) : bt;
    }
    const tree = buildTree(readRecords(raw));
    const paras = [];
    for (const n of tree) if (n.tag === TAG.PARA_HEADER) paras.push(parseParagraph(n, ctx));
    sections.push({ paras });
  }
  return { header: hdr, info, sections, cfb };
}
function inflateOrPlain(u8, compressed) {
  if (!compressed) return u8;
  return inflateRaw(u8);
}

G.HWPLIB = { parseFill, EXT_CHARS, BR, readCFB, AES, decryptViewText, inflateRaw, readRecords, buildTree, parseDocInfo, openHWP, TAG, ctrlName, rgb };
})();
