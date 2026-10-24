/* 한글 수식(수식 편집기 문법)을 간단히 해석해서 그리는 도구
 * 분수(over) · 제곱근 · 위/아래 첨자 · 합/적분/극한 · 괄호 늘이기 · 행렬/cases · 그리스 문자 · 기호 */
(function () {
'use strict';
const H = globalThis.HWPLIB;
const FAM = '"Times New Roman","Nimbus Roman","Noto Serif","Batang","Noto Serif CJK KR",serif';
let _m = null;
const mctx = () => {
  if (!_m) { try { _m = new OffscreenCanvas(4, 4).getContext('2d'); } catch (e) { _m = document.createElement('canvas').getContext('2d'); } }
  return _m;
};

const GREEK = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ');
const GREEK_CH = 'αβγδεζηθικλμνξοπρστυφχψω';
const SYM = {
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', inf: '∞', infty: '∞', infinity: '∞',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  cup: '∪', cap: '∩', therefore: '∴', because: '∵', angle: '∠', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', rarrow: '→', larrow: '←', lrarrow: '↔',
  uparrow: '↑', downarrow: '↓', rarr: '→', larr: '←', RARROW: '⇒', LARROW: '⇐', LRARROW: '⇔', Rightarrow: '⇒', Leftarrow: '⇐', mapsto: '↦',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', degree: '°', deg: '°', prime: '′', triangle: '△', square: '□', circ: '∘', bullet: '•', star: '★',
  oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', emptyset: '∅', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', lnot: '¬', land: '∧', lor: '∨', and: '∧', or: '∨',
  smallsum: '∑', vee: '∨', wedge: '∧', cdotp: '·', ast: '∗', backslash: '\\', setminus: '∖', lt: '<', gt: '>'
};
const FUNCS = new Set('sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp max min det gcd lcm mod Pr dim ker arg sup'.split(' '));
const BIG = { sum: '∑', prod: '∏', int: '∫', oint: '∮', bigcup: '⋃', bigcap: '⋂', iint: '∬', iiint: '∭', coprod: '∐', lim: 'lim', Lim: 'lim' };
const ACC = new Set('vec hat bar dot ddot tilde overline underline check acute grave arch'.split(' '));
const MAT = { matrix: '', pmatrix: '(', bmatrix: '[', dmatrix: '|', vmatrix: '|', cases: 'cases', pile: 'pile', lpile: 'lpile', rpile: 'rpile', eqalign: 'lpile' };
const OPS = new Set(['+', '-', '=', '<', '>', '±', '∓', '×', '÷', '≤', '≥', '≠', '≈', '≡', '→', '←', '↔', '⇒', '⇐', '⇔', '∈', '∉', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∧', '∨', '∼', '∝', '∘', '*']);

/* ---------- 쪼개기 ---------- */
function tokenize(s) {
  const t = []; let i = 0;
  const two = { '<=': '≤', '>=': '≥', '!=': '≠', '->': '→', '<-': '←', '+-': '±', '-+': '∓', '<<': '≪', '>>': '≫', '==': '=' };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') { let j = s.indexOf('"', i + 1); if (j < 0) j = s.length; t.push({ k: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[A-Za-z]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z]/.test(s[j])) j++; t.push({ k: 'w', v: s.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === '.' && /[0-9]/.test(s[j + 1] || '')))) j++; t.push({ k: 'num', v: s.slice(i, j) }); i = j; continue; }
    const d = s.substr(i, 2);
    if (two[d]) { t.push({ k: 'sym', v: two[d] }); i += 2; continue; }
    if ('{}^_~`#&'.includes(c)) { t.push({ k: c }); i++; continue; }
    if (c.charCodeAt(0) > 127) { let j = i; while (j < s.length && s.charCodeAt(j) > 127 && !/\s/.test(s[j])) j++; t.push({ k: 'str', v: s.slice(i, j) }); i = j; continue; }
    t.push({ k: 'sym', v: c === '-' ? '−' : c }); i++;
  }
  return t;
}

/* ---------- 해석 ---------- */
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  function seq(stop) {
    const items = [];
    while (p < tokens.length) {
      const t = peek();
      if (stop === '}' && t.k === '}') break;
      if (stop === 'right' && t.k === 'w' && t.v === 'right') break;
      if (stop === 'row' && (t.k === '#' || t.k === '&' || t.k === '}')) break;
      if (t.k === '}' || t.k === '#' || t.k === '&') { p++; continue; }
      if (t.k === 'w' && (t.v === 'over' || t.v === 'atop')) {
        p++;
        const num = items.pop() || { t: 'grp', items: [] };
        const den = withScripts(atom());
        items.push({ t: 'frac', num, den, bar: t.v === 'over' });
        continue;
      }
      items.push(withScripts(atom()));
    }
    return items;
  }
  function withScripts(b) {
    let out = b;
    while (p < tokens.length && (peek().k === '^' || peek().k === '_')) {
      const up = peek().k === '^'; p++;
      const arg = atom();
      if (out.t === 'bigop') { if (up) out.hi = arg; else out.lo = arg; continue; }
      if (out.t !== 'script') out = { t: 'script', base: out, sup: null, sub: null };
      if (up) out.sup = arg; else out.sub = arg;
    }
    return out;
  }
  function group() { const items = seq('}'); if (peek() && peek().k === '}') p++; return { t: 'grp', items }; }
  function delimTok() {
    const t = tokens[p++]; if (!t) return '.';
    if (t.k === 'sym') return t.v;
    if (t.k === '{') return '{'; if (t.k === '}') return '}';
    if (t.k === 'w') {
      const m = { lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lline: '|', rline: '|', dline: '‖', DLINE: '‖', lbrack: '[', rbrack: ']' };
      return m[t.v] || '.';
    }
    return '.';
  }
  function atom() {
    const t = tokens[p++];
    if (!t) return { t: 'grp', items: [] };
    switch (t.k) {
      case '{': return group();
      case 'num': return { t: 'txt', v: t.v };
      case 'str': return { t: 'txt', v: t.v, str: true };
      case '~': return { t: 'space', em: 0.5 };
      case '`': return { t: 'space', em: 0.17 };
      case 'sym': return { t: 'txt', v: t.v, op: OPS.has(t.v) };
      case '^': case '_': return { t: 'grp', items: [] };
      case 'w': return word(t.v);
      default: return { t: 'grp', items: [] };
    }
  }
  function word(v) {
    const lower = v.toLowerCase();
    if (v === 'sqrt') return { t: 'sqrt', body: atom() };
    if (v === 'root') { const n = atom(); if (peek() && peek().k === 'w' && peek().v === 'of') p++; return { t: 'sqrt', idx: n, body: atom() }; }
    if (v === 'left') {
      const l = delimTok(); const body = { t: 'grp', items: seq('right') };
      if (peek() && peek().k === 'w' && peek().v === 'right') p++;
      const r = delimTok();
      return { t: 'delim', l, r, body };
    }
    if (MAT[v] !== undefined) {
      if (!(peek() && peek().k === '{')) return { t: 'txt', v, str: true };
      p++;
      const rows = []; let row = [];
      for (;;) {
        const cell = seq('row'); row.push({ t: 'grp', items: cell });
        const n = peek();
        if (!n) { rows.push(row); break; }
        if (n.k === '&') { p++; continue; }
        if (n.k === '#') { p++; rows.push(row); row = []; continue; }
        if (n.k === '}') { p++; rows.push(row); break; }
      }
      return { t: 'mat', kind: MAT[v], rows };
    }
    if (BIG[v] !== undefined) {
      const node = { t: 'bigop', op: BIG[v], name: v, lo: null, hi: null };
      for (;;) {
        const n = peek();
        if (n && n.k === 'w' && n.v === 'from') { p++; node.lo = atom(); }
        else if (n && n.k === 'w' && n.v === 'to') { p++; node.hi = atom(); }
        else break;
      }
      return node;
    }
    if (ACC.has(v)) return { t: 'acc', kind: v, body: atom() };
    if (v === 'rm' || v === 'it' || v === 'bold' || v === 'bf') return { t: 'style', v: v === 'bf' ? 'bold' : v };
    if (v === 'from' || v === 'to' || v === 'of' || v === 'right' || v === 'over' || v === 'atop') return { t: 'grp', items: [] };
    if (FUNCS.has(v)) return { t: 'txt', v, fn: true };
    if (SYM[v] !== undefined) return { t: 'txt', v: SYM[v], op: OPS.has(SYM[v]) };
    const gi = GREEK.indexOf(lower);
    if (gi >= 0 && (v === lower || v === v.toUpperCase())) {
      const ch = GREEK_CH[gi]; return { t: 'txt', v: v === lower ? ch : ch.toUpperCase(), ital: v === lower };
    }
    return { t: 'txt', v, ital: true };
  }
  const items = seq(null);
  return { t: 'grp', items };
}

/* ---------- 배치 ---------- */
const AXIS = 0.28;
function fontOf(fs, st, ital) {
  const it = ital && !st.rm;
  return (it ? 'italic ' : '') + (st.bold ? 'bold ' : '') + fs + 'px ' + FAM;
}
function textBox(v, fs, st, ital, extraClass) {
  const m = mctx(); m.font = fontOf(fs, st, ital);
  if ('letterSpacing' in m) m.letterSpacing = '0px';
  const w = m.measureText(v).width;
  const font = m.font;
  return { w, a: fs * 0.78, d: fs * 0.22, draw(ctx, x, y) { ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.fillText(v, x, y); } };
}
function hbox(list) {
  let w = 0, a = 0, d = 0;
  for (const b of list) { w += b.w; a = Math.max(a, b.a); d = Math.max(d, b.d); }
  return { w, a, d, draw(ctx, x, y) { let cx = x; for (const b of list) { b.draw(ctx, cx, y); cx += b.w; } } };
}
function layoutGroup(items, fs, st0) {
  const st = Object.assign({}, st0);
  const out = [];
  let first = true;
  for (const n of items) {
    if (n.t === 'style') { if (n.v === 'rm') st.rm = true; else if (n.v === 'it') { st.rm = false; st.bold = false; } else st.bold = true; continue; }
    const unary = first || (out.length && out[out.length - 1].isOp);
    const b = L(n, fs, st, unary);
    out.push(b); first = false;
  }
  return hbox(out);
}
function L(n, fs, st, unary) {
  switch (n.t) {
    case 'grp': return layoutGroup(n.items, fs, st);
    case 'space': return { w: fs * n.em, a: 0, d: 0, draw() {} };
    case 'txt': {
      if (n.str) { const b = textBox(n.v, fs, { rm: true, bold: st.bold }, false); return b; }
      let v = n.v;
      if (n.fn) { const b = textBox(v, fs, { rm: true, bold: st.bold }, false); const sp = fs * 0.12; return { w: b.w + sp, a: b.a, d: b.d, draw(c, x, y) { b.draw(c, x, y); } }; }
      const ital = n.ital !== undefined ? n.ital : /^[A-Za-z]+$/.test(v);
      const b = textBox(v, fs, st, ital);
      if (n.op && !unary) { const pad = fs * 0.2; const r = { w: b.w + pad * 2, a: b.a, d: b.d, isOp: true, draw(c, x, y) { b.draw(c, x + pad, y); } }; return r; }
      if (n.op) { b.isOp = true; }
      return b;
    }
    case 'script': {
      const base = L(n.base, fs, st);
      const sfs = fs * 0.7;
      const sup = n.sup ? L(n.sup, sfs, st) : null, sub = n.sub ? L(n.sub, sfs, st) : null;
      const gap = fs * 0.04;
      const upY = sup ? Math.max(fs * 0.38, base.a - sup.d - fs * 0.12) : 0;
      const dnY = sub ? Math.max(fs * 0.2, base.d + sub.a - fs * 0.1) : 0;
      const sw = Math.max(sup ? sup.w : 0, sub ? sub.w : 0) + gap;
      return {
        w: base.w + sw, a: Math.max(base.a, sup ? upY + sup.a : 0), d: Math.max(base.d, sub ? dnY + sub.d : 0),
        draw(ctx, x, y) { base.draw(ctx, x, y); if (sup) sup.draw(ctx, x + base.w + gap, y - upY); if (sub) sub.draw(ctx, x + base.w + gap, y + dnY); }
      };
    }
    case 'frac': {
      const num = L(n.num, fs, st), den = L(n.den, fs, st);
      const w = Math.max(num.w, den.w) + fs * 0.24, ax = fs * AXIS, g = fs * 0.12;
      const numBase = ax + g + num.d, denBase = -ax + g + den.a; // 중심축 기준 (위쪽이 +)
      return {
        w, a: numBase + num.a, d: denBase + den.d,
        draw(ctx, x, y) {
          num.draw(ctx, x + (w - num.w) / 2, y - numBase); den.draw(ctx, x + (w - den.w) / 2, y + denBase);
          if (n.bar) { ctx.save(); ctx.lineWidth = Math.max(fs * 0.055, 6); ctx.beginPath(); ctx.moveTo(x + fs * 0.05, y - ax); ctx.lineTo(x + w - fs * 0.05, y - ax); ctx.stroke(); ctx.restore(); }
        }
      };
    }
    case 'sqrt': {
      const body = L(n.body, fs, st);
      const idx = n.idx ? L(n.idx, fs * 0.55, st) : null;
      const lead = Math.max(fs * 0.62, idx ? idx.w + fs * 0.3 : 0);
      const top = body.a + fs * 0.14;
      return {
        w: lead + body.w + fs * 0.08, a: top + fs * 0.08, d: body.d,
        draw(ctx, x, y) {
          ctx.save(); ctx.lineWidth = Math.max(fs * 0.05, 6); ctx.lineJoin = 'miter';
          const bx = x + lead - fs * 0.06;
          ctx.beginPath();
          ctx.moveTo(bx - fs * 0.5, y - (top + body.d) * 0.4 + body.d * 0.2);
          ctx.lineTo(bx - fs * 0.38, y - (top + body.d) * 0.4 - fs * 0.02);
          ctx.lineTo(bx - fs * 0.2, y + body.d);
          ctx.lineTo(bx, y - top);
          ctx.lineTo(x + lead + body.w + fs * 0.06, y - top);
          ctx.stroke(); ctx.restore();
          body.draw(ctx, x + lead, y);
          if (idx) idx.draw(ctx, x + Math.max(0, lead - fs * 0.5 - idx.w), y - top * 0.55);
        }
      };
    }
    case 'delim': {
      const body = L(n.body, fs, st);
      const h = Math.max(body.a + body.d, fs * 1.0) + fs * 0.1;
      const aa = Math.max(body.a, fs * 0.78) + fs * 0.05, dd = Math.max(body.d, fs * 0.22) + fs * 0.05;
      const dw = c => (c === '.' ? 0 : Math.min(fs * 0.55, fs * 0.26 + h * 0.03));
      const wl = dw(n.l), wr = dw(n.r);
      return {
        w: wl + body.w + wr, a: aa, d: dd,
        draw(ctx, x, y) { drawDelim(ctx, n.l, x, y, aa, dd, wl, fs, true); body.draw(ctx, x + wl, y); drawDelim(ctx, n.r, x + wl + body.w, y, aa, dd, wr, fs, false); }
      };
    }
    case 'mat': return layoutMat(n, fs, st);
    case 'bigop': return layoutBig(n, fs, st);
    case 'acc': {
      const b = L(n.body, fs, st);
      const up = n.kind !== 'underline';
      return {
        w: b.w, a: b.a + (up ? fs * 0.24 : 0), d: b.d + (up ? 0 : fs * 0.2),
        draw(ctx, x, y) {
          b.draw(ctx, x, y); ctx.save(); ctx.lineWidth = Math.max(fs * 0.05, 5);
          const ty = y - b.a - fs * 0.08, cx = x + b.w / 2;
          ctx.beginPath();
          switch (n.kind) {
            case 'overline': case 'bar': ctx.moveTo(x, ty); ctx.lineTo(x + b.w, ty); break;
            case 'underline': ctx.moveTo(x, y + b.d + fs * 0.1); ctx.lineTo(x + b.w, y + b.d + fs * 0.1); break;
            case 'vec': ctx.moveTo(x, ty); ctx.lineTo(x + b.w, ty); ctx.moveTo(x + b.w - fs * 0.14, ty - fs * 0.09); ctx.lineTo(x + b.w, ty); ctx.lineTo(x + b.w - fs * 0.14, ty + fs * 0.09); break;
            case 'hat': case 'check': case 'arch': ctx.moveTo(cx - fs * 0.15, ty + fs * 0.02); ctx.lineTo(cx, ty - fs * 0.1); ctx.lineTo(cx + fs * 0.15, ty + fs * 0.02); break;
            case 'tilde': ctx.moveTo(cx - fs * 0.18, ty); ctx.quadraticCurveTo(cx - fs * 0.09, ty - fs * 0.12, cx, ty); ctx.quadraticCurveTo(cx + fs * 0.09, ty + fs * 0.12, cx + fs * 0.18, ty); break;
            case 'dot': ctx.arc(cx, ty - fs * 0.02, fs * 0.035, 0, 7); ctx.fill(); break;
            case 'ddot': ctx.arc(cx - fs * 0.08, ty - fs * 0.02, fs * 0.035, 0, 7); ctx.moveTo(cx + fs * 0.12, ty - fs * 0.02); ctx.arc(cx + fs * 0.08, ty - fs * 0.02, fs * 0.035, 0, 7); ctx.fill(); break;
            default: ctx.moveTo(cx - fs * 0.1, ty); ctx.lineTo(cx + fs * 0.1, ty - fs * 0.05);
          }
          ctx.stroke(); ctx.restore();
        }
      };
    }
    default: return { w: 0, a: 0, d: 0, draw() {} };
  }
}

function drawDelim(ctx, ch, x, y, a, d, w, fs) {
  if (ch === '.' || !w) return;
  const top = y - a, bot = y + d, mid = (top + bot) / 2, h = bot - top;
  ctx.save(); ctx.lineWidth = Math.max(fs * 0.055, 6); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  const X = f => x + w * f;
  switch (ch) {
    case '(': ctx.moveTo(X(0.8), top); ctx.quadraticCurveTo(X(0.0), mid, X(0.8), bot); break;
    case ')': ctx.moveTo(X(0.2), top); ctx.quadraticCurveTo(X(1.0), mid, X(0.2), bot); break;
    case '[': ctx.moveTo(X(0.8), top); ctx.lineTo(X(0.25), top); ctx.lineTo(X(0.25), bot); ctx.lineTo(X(0.8), bot); break;
    case ']': ctx.moveTo(X(0.2), top); ctx.lineTo(X(0.75), top); ctx.lineTo(X(0.75), bot); ctx.lineTo(X(0.2), bot); break;
    case '⌈': ctx.moveTo(X(0.8), top); ctx.lineTo(X(0.25), top); ctx.lineTo(X(0.25), bot); break;
    case '⌉': ctx.moveTo(X(0.2), top); ctx.lineTo(X(0.75), top); ctx.lineTo(X(0.75), bot); break;
    case '⌊': ctx.moveTo(X(0.25), top); ctx.lineTo(X(0.25), bot); ctx.lineTo(X(0.8), bot); break;
    case '⌋': ctx.moveTo(X(0.75), top); ctx.lineTo(X(0.75), bot); ctx.lineTo(X(0.2), bot); break;
    case '{': ctx.moveTo(X(0.85), top); ctx.quadraticCurveTo(X(0.5), top, X(0.5), top + h * 0.14); ctx.lineTo(X(0.5), mid - h * 0.08); ctx.quadraticCurveTo(X(0.5), mid, X(0.1), mid); ctx.quadraticCurveTo(X(0.5), mid, X(0.5), mid + h * 0.08); ctx.lineTo(X(0.5), bot - h * 0.14); ctx.quadraticCurveTo(X(0.5), bot, X(0.85), bot); break;
    case '}': ctx.moveTo(X(0.15), top); ctx.quadraticCurveTo(X(0.5), top, X(0.5), top + h * 0.14); ctx.lineTo(X(0.5), mid - h * 0.08); ctx.quadraticCurveTo(X(0.5), mid, X(0.9), mid); ctx.quadraticCurveTo(X(0.5), mid, X(0.5), mid + h * 0.08); ctx.lineTo(X(0.5), bot - h * 0.14); ctx.quadraticCurveTo(X(0.5), bot, X(0.15), bot); break;
    case '|': ctx.moveTo(X(0.5), top); ctx.lineTo(X(0.5), bot); break;
    case '‖': ctx.moveTo(X(0.3), top); ctx.lineTo(X(0.3), bot); ctx.moveTo(X(0.7), top); ctx.lineTo(X(0.7), bot); break;
    case '<': case '⟨': ctx.moveTo(X(0.75), top); ctx.lineTo(X(0.25), mid); ctx.lineTo(X(0.75), bot); break;
    case '>': case '⟩': ctx.moveTo(X(0.25), top); ctx.lineTo(X(0.75), mid); ctx.lineTo(X(0.25), bot); break;
    default: ctx.moveTo(X(0.5), top); ctx.lineTo(X(0.5), bot);
  }
  ctx.stroke(); ctx.restore();
}

function layoutMat(n, fs, st) {
  const rows = n.rows.map(r => r.map(c => L(c, fs, st)));
  const nC = Math.max(1, ...rows.map(r => r.length));
  const colW = new Array(nC).fill(0);
  rows.forEach(r => r.forEach((b, j) => { colW[j] = Math.max(colW[j], b.w); }));
  const rA = rows.map(r => Math.max(fs * 0.78, ...r.map(b => b.a))), rD = rows.map(r => Math.max(fs * 0.22, ...r.map(b => b.d)));
  const rg = fs * 0.3, cg = fs * (n.kind === 'pile' || n.kind === 'lpile' || n.kind === 'rpile' || n.kind === 'cases' ? 0.4 : 0.8);
  let Ht = 0; rows.forEach((r, i) => { Ht += rA[i] + rD[i]; }); Ht += rg * Math.max(0, rows.length - 1);
  const bodyW = colW.reduce((a, b) => a + b, 0) + cg * (nC - 1);
  const ax = fs * AXIS;
  const a = Ht / 2 + ax, d = Ht / 2 - ax;
  const align = n.kind === 'lpile' || n.kind === 'cases' ? 'l' : n.kind === 'rpile' ? 'r' : 'c';
  const kind = n.kind;
  const lch = kind === 'cases' ? '{' : (kind === '(' || kind === '[' || kind === '|') ? kind : '.';
  const rch = kind === '(' ? ')' : kind === '[' ? ']' : kind === '|' ? '|' : '.';
  const dw = c => (c === '.' ? 0 : fs * 0.3);
  const wl = dw(lch), wr = dw(rch);
  return {
    w: wl + bodyW + wr + fs * 0.1, a, d,
    draw(ctx, x, y) {
      drawDelim(ctx, lch, x, y, a, d, wl, fs); drawDelim(ctx, rch, x + wl + bodyW + fs * 0.1, y, a, d, wr, fs);
      let cy = y - ax - Ht / 2;
      rows.forEach((r, i) => {
        const by = cy + rA[i]; let cx = x + wl + fs * 0.05;
        r.forEach((b, j) => {
          const off = align === 'l' ? 0 : align === 'r' ? colW[j] - b.w : (colW[j] - b.w) / 2;
          b.draw(ctx, cx + off, by); cx += colW[j] + cg;
        });
        cy += rA[i] + rD[i] + rg;
      });
    }
  };
}

function layoutBig(n, fs, st) {
  const side = n.name === 'int' || n.name === 'oint' || n.name === 'iint' || n.name === 'iiint';
  const isLim = n.op === 'lim';
  const ofs = isLim ? fs : fs * (side ? 1.5 : 1.3);
  const m = mctx();
  m.font = (isLim ? '' : '') + ofs + 'px ' + FAM; if ('letterSpacing' in m) m.letterSpacing = '0px';
  const tm = m.measureText(n.op);
  const ow = tm.width + (isLim ? fs * 0.1 : 0);
  let ga = tm.actualBoundingBoxAscent, gd = tm.actualBoundingBoxDescent;
  if (!(ga > 0)) { ga = ofs * 0.75; gd = ofs * 0.2; }
  const dy = isLim ? 0 : -fs * AXIS - (gd - ga) / 2;
  const oa = isLim ? fs * 0.78 : ga - dy, od = isLim ? fs * 0.22 : gd + dy;
  const font = m.font;
  const sfs = fs * 0.7;
  const lo = n.lo ? L(n.lo, sfs, st) : null, hi = n.hi ? L(n.hi, sfs, st) : null;
  const drawOp = (ctx, x, y) => { ctx.font = font; ctx.textBaseline = 'alphabetic'; ctx.fillText(n.op, x, y + dy); };
  if (side) {
    const sw = Math.max(lo ? lo.w : 0, hi ? hi.w : 0);
    const hiY = hi ? oa - hi.d - fs * 0.1 : 0, loY = lo ? od + lo.a - fs * 0.1 : 0;
    return {
      w: ow + sw + fs * 0.08, a: Math.max(oa, hi ? hiY + hi.a : 0), d: Math.max(od, lo ? loY + lo.d : 0),
      draw(ctx, x, y) { drawOp(ctx, x, y); if (hi) hi.draw(ctx, x + ow * 1.05, y - hiY); if (lo) lo.draw(ctx, x + ow * 0.6, y + loY); }
    };
  }
  const w = Math.max(ow, lo ? lo.w : 0, hi ? hi.w : 0) + fs * 0.1;
  const hiY = hi ? oa + hi.d + fs * 0.06 : 0, loY = lo ? od + lo.a + fs * 0.06 : 0;
  return {
    w, a: Math.max(oa, hi ? hiY + hi.a : 0), d: Math.max(od, lo ? loY + lo.d : 0),
    draw(ctx, x, y) {
      drawOp(ctx, x + (w - ow) / 2, y);
      if (hi) hi.draw(ctx, x + (w - hi.w) / 2, y - hiY);
      if (lo) lo.draw(ctx, x + (w - lo.w) / 2, y + loY);
    }
  };
}

/* ---------- 바깥에서 부르는 함수 ---------- */
function drawEquation(ctx, c, x, y, w, h) {
  if (!c._eq) {
    const fs = (c.size && c.size > 100 && c.size < 100000) ? c.size : 1000;
    const tree = parse(tokenize(String(c.script || '')));
    c._eq = { fs, box: layoutGroup(tree.items, fs, { rm: false, bold: false }) };
  }
  const { box } = c._eq;
  const th = box.a + box.d;
  let s = 1;
  if (w > 0 && box.w > w * 1.02) s = Math.min(s, w / box.w);
  if (h > 0 && th > h * 1.05) s = Math.min(s, h / th);
  let yb;
  const bl = c.baseline;
  if (bl > 0 && bl <= 100 && h > 0) yb = y + h * bl / 100; else yb = y + (h - th * s) / 2 + box.a * s;
  yb = Math.max(yb, y + box.a * s * 0.9);
  ctx.save();
  const col = c.color ? 'rgb(' + c.color[0] + ',' + c.color[1] + ',' + c.color[2] + ')' : '#000';
  ctx.fillStyle = col; ctx.strokeStyle = col;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.translate(x, yb); ctx.scale(s, s);
  box.draw(ctx, 0, 0);
  ctx.restore();
}
H.drawEquation = drawEquation;
H.eqParse = s => parse(tokenize(s));
})();
