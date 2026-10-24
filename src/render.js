/* 한글 문서를 쪽으로 나누고 캔버스에 그리기 (단위: HWPUNIT = 1/7200 인치) */
(function () {
'use strict';
const H = globalThis.HWPLIB;
const G = globalThis;

/* ---------- 글꼴 ---------- */
const SERIF_RE = /바탕|명조|Batang|Myeong|Serif|궁서|Gungsuh|신명|함초롬바탕|한컴바탕|Times|Georgia|Cambria|Palatino|Garamond|Book|Mincho|MS 明朝/i;
const MONO_RE = /Courier|굴림체|돋움체|바탕체|궁서체|Consolas|Mono/i;
const KO_SERIF = '"Batang","바탕","Noto Serif CJK KR","Noto Serif KR","Nanum Myeongjo","AppleMyungjo",serif';
const KO_SANS = '"Malgun Gothic","맑은 고딕","Noto Sans CJK KR","Noto Sans KR","Nanum Gothic","Apple SD Gothic Neo",sans-serif';
const famCache = new Map();
function familyFor(name) {
  if (famCache.has(name)) return famCache.get(name);
  const q = '"' + String(name || '').replace(/["\\]/g, '') + '"';
  const f = (name ? q + ',' : '') + (SERIF_RE.test(name) && !/고딕|Gothic|Sans/i.test(name) ? KO_SERIF : KO_SANS);
  famCache.set(name, f);
  return f;
}
// 글자가 속한 언어 칸 (0 한글, 1 영어, 2 한자, 3 일어, 4 기타, 5 기호, 6 사용자)
function langOf(c) {
  if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F) || (c >= 0xA960 && c <= 0xA97F) || (c >= 0xD7B0 && c <= 0xD7FF)) return 0;
  if (c <= 0x24F || (c >= 0x2000 && c <= 0x206F) || (c >= 0x1E00 && c <= 0x1EFF)) return 1;
  if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xF900 && c <= 0xFAFF)) return 2;
  if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x31F0 && c <= 0x31FF)) return 3;
  if ((c >= 0x2190 && c <= 0x2BFF) || (c >= 0x3200 && c <= 0x33FF) || (c >= 0xE000 && c <= 0xF8FF) || (c >= 0xFF00 && c <= 0xFFEF)) return 5;
  if (c >= 0x3000 && c <= 0x303F) return 0;
  return 4;
}

/* ---------- 쪽 나누기 ---------- */
const DEF_PAGE = { w: 59528, h: 84188, l: 8504, r: 8504, t: 5669, b: 4252, head: 4252, foot: 4252, gutter: 0, attr: 0 };

function colRects(body, cols) {
  const n = Math.max(1, cols.count || 1);
  const out = [];
  if (n === 1) return [{ x: body.x, w: body.w }];
  const gap = cols.gap || 0;
  const total = body.w - gap * (n - 1);
  let widths;
  if (cols.same || !cols.widths || cols.widths.length !== n) widths = new Array(n).fill(total / n);
  else { const s = cols.widths.reduce((a, b) => a + b, 0) || 1; widths = cols.widths.map(w => w / s * total); }
  let x = body.x;
  for (let i = 0; i < n; i++) { out.push({ x, w: widths[i] }); x += widths[i] + gap; }
  return out;
}

function paginate(doc) {
  const pages = []; doc.pages = pages; doc.warn = doc.warn || {};
  const warn = k => { doc.warn[k] = (doc.warn[k] || 0) + 1; };
  doc.sections.forEach((sec, si) => {
    let pd = null;
    for (const p of sec.paras) { for (const c of p.controls) if (c.id === 'secd' && c.page) { pd = c.page; break; } if (pd) break; }
    pd = pd || DEF_PAGE;
    let W = pd.w, Hh = pd.h;
    if ((pd.attr & 1) && W < Hh) { const t = W; W = Hh; Hh = t; }
    const body = { x: pd.l + pd.gutter, y: pd.t + pd.head, w: Math.max(1000, W - pd.l - pd.r - pd.gutter), h: Math.max(1000, Hh - pd.t - pd.b - pd.head - pd.foot) };
    let cols = { count: 1, gap: 0, same: true, widths: [] };
    let header = null, footer = null, pgnum = null, pageNo = 0;
    const mk = () => {
      const pg = { sec: si, w: W, h: Hh, pd, body, rects: colRects(body, cols), lines: [], floats: [], header, footer, pgnum, no: ++pageNo };
      pages.push(pg); return pg;
    };
    let cur = mk(), col = 0, prevY = null, first = true;
    for (const p of sec.paras) {
      for (const c of p.controls) {
        if (c.id === 'cold') { cols = { count: c.count || 1, gap: c.gap || 0, same: c.same, widths: c.widths || [] }; if (cur.lines.length === 0) { cur.rects = colRects(body, cols); } }
        else if (c.id === 'head' && c.paras) { header = c; cur.header = c; }
        else if (c.id === 'foot' && c.paras) { footer = c; cur.footer = c; }
        else if (c.id === 'pgnp') { pgnum = c; cur.pgnum = c; }
      }
      let firstPg = cur, firstCol = col, y0 = null;
      p.lines.forEach((ln, li) => {
        if (!first) {
          let brk = false, colBrk = false;
          if (prevY !== null && ln.y < prevY - 2) brk = true;
          if (li === 0 && (p.brk & 4)) brk = true;
          if (li === 0 && (p.brk & 8)) { colBrk = true; }
          if (brk || colBrk) {
            if ((cols.count > 1) && col < cols.count - 1 && !(p.brk & 4 && li === 0)) col++;
            else { cur = mk(); col = 0; cur.rects = colRects(body, cols); }
          }
        }
        if (li === 0) { firstPg = cur; firstCol = col; y0 = ln.y; }
        first = false;
        prevY = ln.y;
        cur.lines.push({ para: p, li, col });
      });
      if (!p.lines.length) first = false;
      for (const c of p.controls) {
        if ((c.id === 'tbl ' || c.id === 'gso ' || c.id === 'eqed') && c.common && !c.common.inline) firstPg.floats.push({ ctrl: c, para: p, col: firstCol, y0: y0 || 0 });
      }
    }
  });
  return pages;
}

/* ---------- 그리기 도구 ---------- */
const BORDER_MM = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
const MM = 7200 / 25.4;
const css = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

function drawSide(ctx, side, x1, y1, x2, y2) {
  if (!side || !side.type) return;
  const w = Math.max(BORDER_MM[side.width] || 0.12, 0.1) * MM;
  ctx.save();
  ctx.strokeStyle = css(side.color); ctx.lineWidth = w; ctx.lineCap = 'butt';
  const t = side.type;
  if (t === 2 || t === 6) ctx.setLineDash([w * 4, w * 2]);
  else if (t === 3 || t === 7) ctx.setLineDash([w, w * 1.5]);
  else if (t === 4 || t === 5) ctx.setLineDash([w * 4, w * 1.5, w, w * 1.5]);
  if (t === 8 || t === 9 || t === 10 || t === 11) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len * w, ny = dx / len * w;
    ctx.lineWidth = w * 0.8;
    ctx.beginPath(); ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny); ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x2 - nx, y2 - ny); ctx.stroke();
  } else { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.restore();
}

function csAt(runs, pos) {
  let lo = 0, hi = runs.length - 1, r = runs.length ? runs[0] : null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (runs[m].pos <= pos) { r = runs[m]; lo = m + 1; } else hi = m - 1; }
  return r;
}

/* ---------- 문단 그리기 ---------- */
function setFont(ctx, doc, cs, lang) {
  const size = Math.max(1, cs.size * (cs.rel[lang] || 100) / 100);
  const f = doc.info.fonts[lang] && doc.info.fonts[lang][cs.font[lang]];
  const fam = familyFor(f ? f.name : '');
  ctx.font = (cs.italic ? 'italic ' : '') + (cs.bold ? 'bold ' : '') + Math.round(size * 10) / 10 + 'px ' + fam;
  const sp = (cs.spacing[lang] || 0) * size / 100;
  if ('letterSpacing' in ctx) ctx.letterSpacing = sp + 'px';
  return { size, ratio: (cs.ratio[lang] || 100) / 100 };
}

function buildEntries(ctx, doc, para, ln, next, justify) {
  const out = [];
  let buf = null;
  const flush = () => { if (buf) { out.push(buf); buf = null; } };
  const info = doc.info;
  for (const it of para.items) {
    if (it.pos < ln.start || it.pos >= next) continue;
    const c = it.ch;
    if (it.ext) {
      flush();
      if (c === 9) out.push({ k: 'tab', w: it.tab, cs: (csAt(para.runs, it.pos) || {}).id });
      else if (it.ctrl && (it.ctrl.id === 'tbl ' || it.ctrl.id === 'gso ' || it.ctrl.id === 'eqed') && it.ctrl.common && it.ctrl.common.inline) out.push({ k: 'obj', ctrl: it.ctrl, w: it.ctrl.common.w, h: it.ctrl.common.h });
      continue;
    }
    if (c === 13 || c === 0) continue;
    if (c === 10) { flush(); out.push({ k: 'br' }); break; }
    let ch = c;
    if (c === 24) ch = 0x2D; else if (c === 30 || c === 31) ch = 0x20; else if (c < 32) continue;
    const r = csAt(para.runs, it.pos); const csId = r ? r.id : 0;
    const cs = info.charShapes[csId] || info.charShapes[0];
    const lang = langOf(ch);
    const isSp = ch === 0x20;
    if (buf && buf.csId === csId && buf.lang === lang && !(justify && (isSp || buf.sp))) { buf.t += String.fromCharCode(ch); }
    else if (buf && buf.csId === csId && buf.lang === lang && !justify) { buf.t += String.fromCharCode(ch); }
    else { flush(); buf = { k: 't', t: String.fromCharCode(ch), cs, csId, lang, sp: isSp }; }
    if (justify && buf && isSp !== buf.sp) { /* 안전장치 */ }
  }
  flush();
  return out;
}

function drawLine(ctx, doc, env, para, li) {
  const ln = para.lines[li];
  const next = li + 1 < para.lines.length ? para.lines[li + 1].start : 1e12;
  const ps = doc.info.paraShapes[para.paraShape] || { align: 1, indent: 0 };
  const lastLine = li === para.lines.length - 1;
  const justify = ps.align === 0 && !lastLine;
  let x0 = env.frame.x + ln.x, avail = ln.w;
  if (avail <= 0) avail = env.frame.w || 0;
  if ((ln.tag & (1 << 20)) && ps.indent < 0) { const sh = -ps.indent / 2; x0 += sh; avail -= sh; }
  const top = env.frame.y + ln.y, base = top + ln.base;

  const ent = buildEntries(ctx, doc, para, ln, next, justify);
  // 줄 끝의 공백은 폭에서 뺀다
  while (ent.length && ent[ent.length - 1].k === 't' && /^\s*$/.test(ent[ent.length - 1].t)) ent.pop();
  while (ent.length && ent[ent.length - 1].k === 'br') ent.pop();
  if (!ent.length) return;
  // 토막 폭 재기
  let textW = 0, fixedW = 0, spaces = 0;
  for (const e of ent) {
    if (e.k === 't') {
      const f = setFont(ctx, doc, e.cs, e.lang); e.size = f.size; e.ratio = f.ratio;
      e.w = ctx.measureText(e.t).width * f.ratio;
      if (justify) { for (const ch of e.t) if (ch === ' ') spaces++; }
      textW += e.w;
    } else if (e.k === 'tab') {
      let w = e.w;
      if (!(w > 0 && w < 40000)) { const cs = doc.info.charShapes[e.cs] || doc.info.charShapes[0]; const f = setFont(ctx, doc, cs, 1); w = f.size * 2; }
      e.w = w; fixedW += w;
    } else if (e.k === 'obj') fixedW += e.w;
  }
  let sx = 1, extra = 0;
  const nat = textW + fixedW;
  if (nat > avail && textW > 0) sx = Math.max(0.6, (avail - fixedW) / textW);
  else if (justify && spaces > 0 && avail > nat) extra = (avail - nat) / spaces;
  let x = x0;
  const used = nat * (sx < 1 ? 1 : 1) - (sx < 1 ? textW * (1 - sx) : 0) + extra * spaces;
  if (!justify) {
    if (ps.align === 2) x = x0 + avail - used; else if (ps.align === 3) x = x0 + (avail - used) / 2;
  }
  for (const e of ent) {
    if (e.k === 't') {
      const cs = e.cs; const f = setFont(ctx, doc, cs, e.lang);
      let dy = 0, size = f.size;
      if (cs.sup) { dy = -size * 0.35; } else if (cs.sub) { dy = size * 0.15; }
      dy -= (cs.off[e.lang] || 0) * size / 100;
      ctx.fillStyle = css(cs.color);
      const rx = f.ratio * sx;
      if (justify && extra > 0) {
        // 낱말 단위로 그려 공백을 늘린다
        const parts = e.t.split(/( +)/);
        for (const part of parts) {
          if (!part) continue;
          const wd = ctx.measureText(part).width * rx;
          if (/^ +$/.test(part)) { x += wd + extra * part.length; continue; }
          drawText(ctx, part, x, base + dy, rx, cs, size, wd);
          x += wd;
        }
      } else {
        const wd = ctx.measureText(e.t).width * rx;
        drawText(ctx, e.t, x, base + dy, rx, cs, size, wd);
        x += wd;
      }
    } else if (e.k === 'tab') x += e.w;
    else if (e.k === 'obj') {
      let oy = top;
      if (e.h < ln.h * 0.9) oy = Math.max(top, base - e.h);
      drawObject(ctx, doc, env, e.ctrl, x, oy, e.w, e.h);
      x += e.w;
    }
  }
}
function drawText(ctx, text, x, y, rx, cs, size, wd) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, 0);
  ctx.restore();
  if (cs.underline) { ctx.save(); ctx.strokeStyle = css(cs.ulColor || cs.color); ctx.lineWidth = Math.max(size / 20, 8); ctx.beginPath(); ctx.moveTo(x, y + size * 0.12); ctx.lineTo(x + wd, y + size * 0.12); ctx.stroke(); ctx.restore(); }
  if (cs.strike) { ctx.save(); ctx.strokeStyle = css(cs.color); ctx.lineWidth = Math.max(size / 20, 8); ctx.beginPath(); ctx.moveTo(x, y - size * 0.3); ctx.lineTo(x + wd, y - size * 0.3); ctx.stroke(); ctx.restore(); }
}

// 문단 묶음(표 칸·글상자·머리말)을 틀 안에 그린다
function drawParas(ctx, doc, env, paras) {
  for (const p of paras) {
    for (let i = 0; i < p.lines.length; i++) drawLine(ctx, doc, env, p, i);
    for (const c of p.controls) {
      if ((c.id === 'tbl ' || c.id === 'gso ' || c.id === 'eqed') && c.common && !c.common.inline) {
        const y0 = p.lines.length ? p.lines[0].y : 0;
        drawFloat(ctx, doc, env, c, p, y0);
      }
    }
  }
}
function parasHeight(paras) {
  let h = 0;
  for (const p of paras) for (const l of p.lines) h = Math.max(h, l.y + l.h);
  return h;
}

/* ---------- 개체 ---------- */
function drawObject(ctx, doc, env, c, x, y, w, h) {
  try {
    if (c.id === 'tbl ') drawTable(ctx, doc, env, c, x, y);
    else if (c.id === 'gso ') { if (c.shape) drawShape(ctx, doc, env, c.shape, x, y, w || c.common.w, h || c.common.h); }
    else if (c.id === 'eqed') drawEquation(ctx, doc, c, x, y, w, h);
  } catch (e) { doc.warn.drawError = (doc.warn.drawError || 0) + 1; doc.lastError = e && e.stack || String(e); }
}

function drawFloat(ctx, doc, env, c, para, y0) {
  const cm = c.common;
  const w = cm.w, h = cm.h;
  const page = env.page, fr = env.frame;
  let bx, bw, by, bh;
  const colX = fr.x, colW = fr.w || (page ? page.body.w : 0);
  switch (cm.horzRel) {
    case 0: bx = page ? 0 : fr.x; bw = page ? page.w : colW; break;
    case 1: bx = page ? page.body.x : fr.x; bw = page ? page.body.w : colW; break;
    case 2: bx = colX; bw = colW; break;
    default: bx = colX; bw = colW; break;
  }
  switch (cm.vertRel) {
    case 0: by = page ? 0 : fr.y; bh = page ? page.h : 0; break;
    case 1: by = page ? page.body.y : fr.y; bh = page ? page.body.h : 0; break;
    default: by = fr.y + y0; bh = 0; break;
  }
  let x = bx + cm.x, y = by + cm.y;
  if (cm.horzAlign === 1) x = bx + (bw - w) / 2 + cm.x; else if (cm.horzAlign === 2) x = bx + bw - w - cm.x;
  if (bh) { if (cm.vertAlign === 1) y = by + (bh - h) / 2 + cm.y; else if (cm.vertAlign === 2) y = by + bh - h - cm.y; }
  drawObject(ctx, doc, env, c, x, y, w, h);
}

function tableGrid(c) {
  const nC = c.cols, nR = c.rows;
  const colW = new Array(nC).fill(0), rowH = new Array(nR).fill(0);
  const cells = c.cells.filter(k => k.col < nC && k.row < nR);
  for (const k of cells) {
    if (k.colSpan === 1) colW[k.col] = Math.max(colW[k.col], k.w);
    if (k.rowSpan === 1) {
      // 칸 안의 글이 저장된 높이보다 크면 한글처럼 줄 높이를 늘린다
      const pad = k.pad && k.pad.some(v => v) ? k.pad : (c.pad || [0, 0, 0, 0]);
      const need = parasHeight(k.paras) + pad[2] + pad[3];
      rowH[k.row] = Math.max(rowH[k.row], k.h, need);
    }
  }
  for (const k of cells) {
    if (k.colSpan > 1) { let s = 0, un = 0; for (let i = 0; i < k.colSpan; i++) { s += colW[k.col + i] || 0; if (!colW[k.col + i]) un++; } if (un) for (let i = 0; i < k.colSpan; i++) if (!colW[k.col + i]) colW[k.col + i] = Math.max(0, (k.w - s) / un); }
    if (k.rowSpan > 1) { let s = 0, un = 0; for (let i = 0; i < k.rowSpan; i++) { s += rowH[k.row + i] || 0; if (!rowH[k.row + i]) un++; } if (un) for (let i = 0; i < k.rowSpan; i++) if (!rowH[k.row + i]) rowH[k.row + i] = Math.max(0, (k.h - s) / un); }
  }
  const xs = [0], ys = [0];
  for (let i = 0; i < nC; i++) xs.push(xs[i] + colW[i]);
  for (let i = 0; i < nR; i++) ys.push(ys[i] + rowH[i]);
  return { xs, ys, cells };
}

function drawTable(ctx, doc, env, c, x, y) {
  const g = tableGrid(c);
  const bfs = doc.info.borderFills;
  const rects = [];
  for (const k of g.cells) {
    const cx = x + g.xs[k.col], cy = y + g.ys[k.row];
    const cw = g.xs[Math.min(c.cols, k.col + k.colSpan)] - g.xs[k.col], ch = g.ys[Math.min(c.rows, k.row + k.rowSpan)] - g.ys[k.row];
    const bf = bfs[(k.borderFill || 0) - 1];
    rects.push({ k, cx, cy, cw, ch, bf });
    if (bf && bf.fill) { ctx.fillStyle = css(bf.fill); ctx.fillRect(cx, cy, cw, ch); }
    else if (bf && bf.img) { const im = doc.images && doc.images.get(bf.img); if (im) ctx.drawImage(im, cx, cy, cw, ch); }
  }
  for (const r of rects) {
    const k = r.k;
    let pad = k.pad || [0, 0, 0, 0];
    if (!pad.some(v => v) && c.pad) pad = c.pad;
    const innerW = r.cw - pad[0] - pad[1], innerH = r.ch - pad[2] - pad[3];
    const content = parasHeight(k.paras);
    let off = 0;
    if (k.vAlign === 1) off = Math.max(0, (innerH - content) / 2); else if (k.vAlign === 2) off = Math.max(0, innerH - content);
    const frame = { x: r.cx + pad[0], y: r.cy + pad[2] + off, w: innerW };
    drawParas(ctx, doc, { page: env.page, frame }, k.paras);
  }
  for (const r of rects) {
    if (!r.bf) continue;
    const s = r.bf.sides;
    drawSide(ctx, s[0], r.cx, r.cy, r.cx, r.cy + r.ch);
    drawSide(ctx, s[1], r.cx + r.cw, r.cy, r.cx + r.cw, r.cy + r.ch);
    drawSide(ctx, s[2], r.cx, r.cy, r.cx + r.cw, r.cy);
    drawSide(ctx, s[3], r.cx, r.cy + r.ch, r.cx + r.cw, r.cy + r.ch);
  }
}

function binFor(doc, id) {
  const m = doc.info.binMap;
  return m.get(id) || [...m.values()][id - 1] || null;
}

function drawShape(ctx, doc, env, s, x, y, w, h) {
  if (s.kind === 'pic') {
    const bin = binFor(doc, s.binId);
    const bmp = bin && doc.images && doc.images.get(bin.id);
    if (bmp) {
      let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
      if (s.pts && s.crop) {
        const pw = Math.abs(s.pts[1][0] - s.pts[0][0]) || 0, ph = Math.abs(s.pts[3][1] - s.pts[0][1]) || 0;
        if (pw > 0 && ph > 0 && (s.crop[2] - s.crop[0]) > 0 && (s.crop[3] - s.crop[1]) > 0) {
          sx = s.crop[0] / pw * bmp.width; sy = s.crop[1] / ph * bmp.height;
          sw = (s.crop[2] - s.crop[0]) / pw * bmp.width; sh = (s.crop[3] - s.crop[1]) / ph * bmp.height;
          if (sx < 0 || sy < 0 || sx + sw > bmp.width + 1 || sy + sh > bmp.height + 1) { sx = 0; sy = 0; sw = bmp.width; sh = bmp.height; }
        }
      }
      ctx.save();
      if (s.flip & 1) { ctx.translate(x + w, 0); ctx.scale(-1, 1); x = 0; }
      ctx.drawImage(bmp, sx, sy, sw, sh, x, y, w, h);
      ctx.restore();
    } else {
      ctx.save(); ctx.strokeStyle = '#999'; ctx.lineWidth = 20; ctx.strokeRect(x, y, w, h);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke(); ctx.restore();
      doc.warn.pictureNotShown = (doc.warn.pictureNotShown || 0) + 1;
    }
    if (s.border && s.border.width > 0 && s.border.attr !== undefined && (s.border.color[0] + s.border.color[1] + s.border.color[2]) >= 0 && s.border.width > 5) {
      ctx.save(); ctx.strokeStyle = css(s.border.color); ctx.lineWidth = s.border.width; ctx.strokeRect(x, y, w, h); ctx.restore();
    }
    return;
  }
  ctx.save();
  const ln = s.line, fl = s.fill;
  const hasStroke = ln && ln.type !== 0 && ln.width >= 0;
  const stroke = () => { if (hasStroke) { ctx.strokeStyle = css(ln.color); ctx.lineWidth = Math.max(ln.width, 8); const t = ln.type; if (t === 2 || t === 6) ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 2]); else if (t === 3 || t === 7) ctx.setLineDash([ctx.lineWidth, ctx.lineWidth * 1.5]); ctx.stroke(); } };
  if (s.kind === 'rect') {
    ctx.beginPath(); ctx.rect(x, y, w, h);
    if (fl && fl.color) { ctx.fillStyle = css(fl.color); ctx.fill(); }
    stroke();
  } else if (s.kind === 'ellipse') {
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    if (fl && fl.color) { ctx.fillStyle = css(fl.color); ctx.fill(); }
    stroke();
  } else if (s.kind === 'line') {
    const p = s.pt || [0, 0, w, h]; const ow = s.origW || w || 1, oh = s.origH || h || 1;
    const kx = ow ? w / ow : 1, ky = oh ? h / oh : 1;
    ctx.beginPath(); ctx.moveTo(x + p[0] * kx, y + p[1] * ky); ctx.lineTo(x + p[2] * kx, y + p[3] * ky);
    if (!hasStroke) { ctx.strokeStyle = '#000'; ctx.lineWidth = 12; ctx.stroke(); } else stroke();
  } else if (s.kind === 'poly' && s.poly && s.poly.length > 1) {
    const ow = s.origW || w || 1, oh = s.origH || h || 1; const kx = w / ow, ky = h / oh;
    ctx.beginPath(); s.poly.forEach((p, i) => { const px = x + p[0] * kx, py = y + p[1] * ky; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath();
    if (fl && fl.color) { ctx.fillStyle = css(fl.color); ctx.fill(); }
    stroke();
  } else if (s.kind === 'group') {
    const ow = s.origW || w || 1, oh = s.origH || h || 1; const kx = w / ow, ky = h / oh;
    for (const k of s.kids) drawShape(ctx, doc, env, k, x + k.offX * kx, y + k.offY * ky, k.curW * kx, k.curH * ky);
  } else if (s.kind === 'curve' || s.kind === 'arc' || s.kind === 'ole' || s.kind === 'unknown') {
    if (s.kind !== 'unknown' || !s.text) { doc.warn['도형(' + s.kind + ')'] = (doc.warn['도형(' + s.kind + ')'] || 0) + 1; }
    if (s.kind !== 'unknown') { ctx.strokeStyle = '#bbb'; ctx.lineWidth = 10; ctx.strokeRect(x, y, w, h); }
  }
  ctx.restore();
  if (s.text && s.text.length) {
    const m = s.textMargin || [510, 510, 141, 141];
    const innerH = h - m[2] - m[3];
    const ch = parasHeight(s.text);
    const va = (s.textAttr >> 5) & 3;
    const off = va === 1 ? Math.max(0, (innerH - ch) / 2) : va === 2 ? Math.max(0, innerH - ch) : 0;
    drawParas(ctx, doc, { page: env.page, frame: { x: x + m[0], y: y + m[2] + off, w: w - m[0] - m[1] } }, s.text);
  }
}

function drawEquation(ctx, doc, c, x, y, w, h) {
  // 수식 그리기(간이): 수식 개체의 자리와 크기를 지키고, 안에 수식 문자를 보여준다
  const E = H.drawEquation;
  if (E) { try { E(ctx, c, x, y, w, h); doc.warn['수식'] = (doc.warn['수식'] || 0) + 1; return; } catch (e) { /* 아래 대체 표시 */ } }
  doc.warn['수식'] = (doc.warn['수식'] || 0) + 1;
  ctx.save();
  const size = Math.min(h * 0.7, 1100);
  ctx.font = 'italic ' + size + 'px "Times New Roman","Noto Serif CJK KR",serif';
  ctx.fillStyle = c.color ? css(c.color) : '#000';
  ctx.textBaseline = 'middle';
  const t = String(c.script || '').replace(/\s+/g, ' ');
  const mw = ctx.measureText(t).width || 1;
  const sc = mw > w ? w / mw : 1;
  ctx.translate(x, y + h / 2); ctx.scale(sc, 1);
  ctx.fillText(t, 0, 0);
  ctx.restore();
}

/* ---------- 쪽 그리기 ---------- */
function drawPage(doc, idx, ctx) {
  const pg = doc.pages[idx];
  if (!pg) return;
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pg.w, pg.h);
  ctx.fillStyle = '#000';
  const envFor = col => ({ page: pg, frame: { x: pg.rects[Math.min(col, pg.rects.length - 1)].x, y: pg.body.y, w: pg.rects[Math.min(col, pg.rects.length - 1)].w } });
  const floatsAt = behind => {
    for (const f of pg.floats) {
      if ((f.ctrl.common.wrap === 4) !== behind) continue;
      drawFloat(ctx, doc, envFor(f.col), f.ctrl, f.para, f.y0);
    }
  };
  floatsAt(true);
  // 줄
  for (const L of pg.lines) drawLine(ctx, doc, envFor(L.col), L.para, L.li);
  floatsAt(false);
  // 머리말 · 꼬리말
  const hdrOK = h => !!(h && h.paras) && (((h.attr & 3) === 1) ? pg.no % 2 === 0 : ((h.attr & 3) === 2) ? pg.no % 2 === 1 : true);
  if (pg.header && hdrOK(pg.header)) drawParas(ctx, doc, { page: pg, frame: { x: pg.pd.l + pg.pd.gutter, y: pg.pd.t, w: pg.body.w } }, pg.header.paras);
  if (pg.footer && hdrOK(pg.footer)) drawParas(ctx, doc, { page: pg, frame: { x: pg.pd.l + pg.pd.gutter, y: pg.h - pg.pd.b - pg.pd.foot, w: pg.body.w } }, pg.footer.paras);
  // 쪽 번호
  if (pg.pgnum && pg.pgnum.pos) {
    const pos = pg.pgnum.pos; const text = String(pg.no);
    ctx.fillStyle = '#000'; ctx.font = '1000px "Malgun Gothic","Noto Sans CJK KR",sans-serif'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const tw = ctx.measureText(text).width;
    const top = pos <= 3 || pos === 7 || pos === 8 || pos === 9;
    const yy = top ? pg.pd.t / 2 : pg.h - pg.pd.b / 2;
    const hz = ((pos - 1) % 3);
    const xx = hz === 0 ? pg.body.x : hz === 1 ? pg.body.x + (pg.body.w - tw) / 2 : pg.body.x + pg.body.w - tw;
    if (pos >= 1 && pos <= 6) ctx.fillText(text, xx, yy);
  }
  ctx.restore();
}

/* ---------- 그림 미리 풀어두기 ---------- */
async function loadImages(doc) {
  doc.images = new Map();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };
  for (const bin of doc.info.binMap.values()) {
    const m = mime[bin.ext];
    if (!m) { doc.warn['그림 형식(' + bin.ext + ')'] = (doc.warn['그림 형식(' + bin.ext + ')'] || 0) + 1; continue; }
    try { doc.images.set(bin.id, await G.createImageBitmap(new Blob([bin.data], { type: m }))); } catch (e) { doc.warn['그림 읽기 실패'] = (doc.warn['그림 읽기 실패'] || 0) + 1; }
  }
}

H.paginate = paginate;
H.drawPage = drawPage;
H.loadImages = loadImages;
})();
