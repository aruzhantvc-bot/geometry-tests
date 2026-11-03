// Построение чертежей из JSON-описания: точки вычисляются, затем всё рисуется в SVG.
// PNG получается растеризацией того же SVG (см. svgToPng).
(function () {
  'use strict';

  const COLORS = { main: '#111111', accent: '#1f6fd6', aux: '#9a9aa0', red: '#d0342c', green: '#1e8e3e' };
  const FONT = "'Times New Roman', 'Cambria', 'Noto Serif', serif";

  class FigureError extends Error {}

  // ---------- векторная арифметика ----------
  const add = (a, b) => a.map((v, i) => v + (b[i] || 0));
  const sub = (a, b) => a.map((v, i) => v - (b[i] || 0));
  const mul = (a, k) => a.map(v => v * k);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
  const len = a => Math.sqrt(dot(a, a));
  const rad = d => d * Math.PI / 180;
  const pad3 = a => (a.length === 3 ? a : [a[0], a[1], 0]);

  function lineIntersect(p1, p2, p3, p4) {
    const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
    if (Math.abs(d) < 1e-12) throw new FigureError('Прямые параллельны — точку пересечения найти нельзя');
    const a = p1[0] * p2[1] - p1[1] * p2[0], b = p3[0] * p4[1] - p3[1] * p4[0];
    return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
  }
  function foot(p, a, b) {
    const ab = sub(b, a), t = dot(sub(p, a), ab) / dot(ab, ab);
    return add(a, mul(ab, t));
  }
  function circumcenter(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) throw new FigureError('Точки лежат на одной прямой — описанной окружности нет');
    const A = dot(a, a), B = dot(b, b), C = dot(c, c);
    return [(A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d,
            (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d];
  }
  function incenter(a, b, c) {
    const la = len(sub(b, c)), lb = len(sub(a, c)), lc = len(sub(a, b)), p = la + lb + lc;
    return [(la * a[0] + lb * b[0] + lc * c[0]) / p, (la * a[1] + lb * b[1] + lc * c[1]) / p];
  }
  function inradius(a, b, c) {
    const la = len(sub(b, c)), lb = len(sub(a, c)), lc = len(sub(a, b)), s = (la + lb + lc) / 2;
    return Math.sqrt(Math.max(0, s * (s - la) * (s - lb) * (s - lc))) / s;
  }

  // ---------- вычисление точек ----------
  function resolvePoints(defs) {
    const out = {}, busy = {};
    const get = name => {
      if (Array.isArray(name)) return name.map(Number);
      if (out[name]) return out[name];
      if (!(name in defs)) throw new FigureError(`Точка «${name}» не задана в "points"`);
      if (busy[name]) throw new FigureError(`Циклическое определение точки «${name}»`);
      busy[name] = true;
      out[name] = compute(name, defs[name]);
      busy[name] = false;
      return out[name];
    };
    const num = (v, what) => {
      const n = Number(v);
      if (!isFinite(n)) throw new FigureError(`Ожидалось число (${what}), получено ${JSON.stringify(v)}`);
      return n;
    };
    function compute(name, d) {
      if (Array.isArray(d)) {
        if (d.length < 2 || d.some(v => !isFinite(Number(v)))) throw new FigureError(`Точка «${name}»: координаты должны быть числами`);
        return d.map(Number);
      }
      if (!d || typeof d !== 'object') throw new FigureError(`Точка «${name}»: неверное описание`);
      const [kind] = Object.keys(d), a = d[kind];
      if (!Array.isArray(a)) throw new FigureError(`Точка «${name}»: значение "${kind}" должно быть массивом`);
      switch (kind) {
        case 'mid': return mul(add(get(a[0]), get(a[1])), 0.5);
        case 'ratio': { const A = get(a[0]), B = get(a[1]), m = num(a[2], 'ratio'), n = num(a[3], 'ratio');
          return add(A, mul(sub(B, A), m / (m + n))); }
        case 'foot': return foot(get(a[0]), get(a[1]), get(a[2]));
        case 'intersect': return lineIntersect(get(a[0]), get(a[1]), get(a[2]), get(a[3]));
        case 'polar': { const O = get(a[0]), r = num(a[1], 'polar r'), t = rad(num(a[2], 'polar deg'));
          return [O[0] + r * Math.cos(t), O[1] + r * Math.sin(t)].concat(O.length === 3 ? [O[2]] : []); }
        case 'onBase': { const O = pad3(get(a[0])), r = num(a[1], 'r'), t = rad(num(a[2], 'deg'));
          return [O[0] + r * Math.cos(t), O[1] + r * Math.sin(t), O[2]]; }
        case 'rotate': { const P = get(a[0]), O = get(a[1]), t = rad(num(a[2], 'deg')), v = sub(P, O);
          return [O[0] + v[0] * Math.cos(t) - v[1] * Math.sin(t), O[1] + v[0] * Math.sin(t) + v[1] * Math.cos(t)]; }
        case 'parallelogram': return sub(add(get(a[0]), get(a[2])), get(a[1]));
        case 'translate': return add(get(a[0]), sub(get(a[2]), get(a[1])));
        case 'reflect': {
          const P = get(a[0]);
          if (a.length === 2) return sub(mul(get(a[1]), 2), P);
          return sub(mul(foot(P, get(a[1]), get(a[2])), 2), P);
        }
        case 'incenter': return incenter(get(a[0]), get(a[1]), get(a[2]));
        case 'circumcenter': return circumcenter(get(a[0]), get(a[1]), get(a[2]));
        case 'centroid': { const ps = a.map(get); return mul(ps.reduce((s, p) => add(s, p)), 1 / ps.length); }
        default: throw new FigureError(`Точка «${name}»: неизвестный способ "${kind}"`);
      }
    }
    Object.keys(defs || {}).forEach(get);
    return { pts: out, get };
  }

  // ---------- безопасный парсер формул для графиков ----------
  function compileExpr(src) {
    const s = String(src).replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/−/g, '-').replace(/·/g, '*');
    let i = 0;
    const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan, sqrt: Math.sqrt, abs: Math.abs,
      ln: Math.log, log: Math.log10, exp: Math.exp, ctg: x => 1 / Math.tan(x) };
    const peek = () => s[i];
    function expr() { let n = term(); while (peek() === '+' || peek() === '-') { const op = s[i++], r = term(), l = n; n = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x); } return n; }
    function term() {
      let n = unary();
      for (;;) {
        if (peek() === '*' || peek() === '/') { const op = s[i++], r = unary(), l = n; n = op === '*' ? x => l(x) * r(x) : x => l(x) / r(x); }
        else if (peek() && /[0-9a-zπ(.√]/i.test(peek())) { const r = unary(), l = n; n = x => l(x) * r(x); } // неявное умножение: 2x
        else return n;
      }
    }
    function unary() { if (peek() === '-') { i++; const n = unary(); return x => -n(x); } if (peek() === '+') { i++; return unary(); } return power(); }
    function power() { const b = atom(); if (peek() === '^') { i++; const e = unary(); return x => Math.pow(b(x), e(x)); } return b; }
    function atom() {
      const c = peek();
      if (c === '(') { i++; const n = expr(); if (s[i++] !== ')') throw new FigureError('Формула: не хватает ")"'); return n; }
      if (c === '|') { i++; const n = expr(); if (s[i++] !== '|') throw new FigureError('Формула: не хватает "|"'); return x => Math.abs(n(x)); }
      if (c === '√') { i++; const n = power(); return x => Math.sqrt(n(x)); }
      if (c === 'π') { i++; return () => Math.PI; }
      const num = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { i += num[0].length; const v = parseFloat(num[0]); return () => v; }
      const id = /^[a-z]+/i.exec(s.slice(i));
      if (id) {
        let w = id[0].toLowerCase();
        // самое длинное известное имя функции в начале слова
        const fn = Object.keys(FN).sort((a, b) => b.length - a.length).find(f => w.startsWith(f));
        if (fn) { i += fn.length; const arg = power(); const f = FN[fn]; return x => f(arg(x)); }
        if (w.startsWith('pi')) { i += 2; return () => Math.PI; }
        if (w[0] === 'x') { i++; return x => x; }
        if (w[0] === 'e') { i++; return () => Math.E; }
        throw new FigureError(`Формула: неизвестное имя "${id[0]}"`);
      }
      throw new FigureError(`Формула: неожиданный символ "${c || 'конец строки'}" в "${src}"`);
    }
    const f = expr();
    if (i < s.length) throw new FigureError(`Формула: лишний символ "${s[i]}" в "${src}"`);
    return f;
  }

  // ---------- текст с индексами и степенями ----------
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // Подпись точки: A1 / A_1 / A₁ → A с нижним индексом; ' и штрихи сохраняются
  function labelParts(t) {
    t = String(t);
    let m = /^([A-Za-zА-Яа-яα-ωΑ-Ω])_?\{?(\d+)\}?('*)$/.exec(t);
    if (m) return [[m[1], ''], [m[2], 'sub'], [m[3], '']];
    const parts = []; const re = /\^([^^]+)\^|~([^~]+)~/g; let last = 0, r;
    while ((r = re.exec(t))) { if (r.index > last) parts.push([t.slice(last, r.index), '']); parts.push(r[1] ? [r[1], 'sup'] : [r[2], 'sub']); last = re.lastIndex; }
    if (last < t.length) parts.push([t.slice(last), '']);
    return parts;
  }
  function textSvg(x, y, t, opt = {}) {
    const size = opt.size || 18, italic = opt.italic ? ' font-style="italic"' : '', color = opt.color || COLORS.main;
    const anchor = opt.anchor || 'middle';
    const spans = labelParts(t).filter(p => p[0] !== '').map(([s, k]) => k === 'sub'
      ? `<tspan font-size="${size * 0.68}" dy="${size * 0.28}" font-style="normal">${esc(s)}</tspan><tspan dy="${-size * 0.28}"></tspan>`
      : k === 'sup' ? `<tspan font-size="${size * 0.68}" dy="${-size * 0.4}" font-style="normal">${esc(s)}</tspan><tspan dy="${size * 0.4}"></tspan>`
      : `<tspan>${esc(s)}</tspan>`).join('');
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size}"${italic} fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${spans}</text>`;
  }
  const textWidth = (t, size = 18) => labelParts(t).reduce((w, [s, k]) => w + s.length * size * (k ? 0.4 : 0.55), 0) + 4;

  // ---------- геометрия на экране ----------
  function segBoxHit(a, b, box) {
    // пересекает ли отрезок прямоугольник [x1,y1,x2,y2]
    const inside = p => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
    if (inside(a) || inside(b)) return true;
    const edges = [[[box[0], box[1]], [box[2], box[1]]], [[box[2], box[1]], [box[2], box[3]]], [[box[2], box[3]], [box[0], box[3]]], [[box[0], box[3]], [box[0], box[1]]]];
    return edges.some(([c, d]) => segSegHit(a, b, c, d));
  }
  function segSegHit(p1, p2, p3, p4) {
    const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    return o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2);
  }
  const boxHit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  function clipLineToRect(p, dir, W, H, ray) {
    // точки пересечения прямой p + t·dir с рамкой
    const ts = [];
    if (Math.abs(dir[0]) > 1e-9) { ts.push((0 - p[0]) / dir[0], (W - p[0]) / dir[0]); }
    if (Math.abs(dir[1]) > 1e-9) { ts.push((0 - p[1]) / dir[1], (H - p[1]) / dir[1]); }
    const ok = ts.filter(t => { const q = [p[0] + t * dir[0], p[1] + t * dir[1]]; return q[0] >= -0.5 && q[0] <= W + 0.5 && q[1] >= -0.5 && q[1] <= H + 0.5; });
    if (!ok.length) return null;
    let t0 = Math.min(...ok), t1 = Math.max(...ok);
    if (ray) t0 = 0;
    return [[p[0] + t0 * dir[0], p[1] + t0 * dir[1]], [p[0] + t1 * dir[0], p[1] + t1 * dir[1]]];
  }

  // ---------- главная функция ----------
  function render(spec, opts = {}) {
    try { return { svg: build(spec, opts) }; }
    catch (e) {
      const msg = e instanceof FigureError ? e.message : ('Ошибка построения: ' + e.message);
      return { error: msg, svg: errorSvg(msg) };
    }
  }
  function errorSvg(msg) {
    const lines = []; let cur = '';
    String(msg).split(' ').forEach(w => { if ((cur + ' ' + w).length > 52) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
    lines.push(cur);
    const body = lines.map((l, i) => `<text x="20" y="${70 + i * 22}" font-family="sans-serif" font-size="16" fill="#b3261e">${esc(l)}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 ${110 + lines.length * 22}" width="520" height="${110 + lines.length * 22}"><rect width="100%" height="100%" fill="#fff4f2" stroke="#e8b4ae"/><text x="20" y="38" font-family="sans-serif" font-size="17" font-weight="bold" fill="#b3261e">Чертёж не построен</text>${body}<text x="20" y="${92 + lines.length * 22}" font-family="sans-serif" font-size="13" fill="#6b6b6b">Нажмите «Код рисунка» или «Исправить с Claude».</text></svg>`;
  }

  function build(spec, opts) {
    if (typeof spec === 'string') { try { spec = JSON.parse(spec); } catch (e) { throw new FigureError('Код рисунка — не корректный JSON: ' + e.message); } }
    if (!spec || typeof spec !== 'object') throw new FigureError('Пустое описание рисунка');
    const view = spec.view || 'plane';
    const elements = Array.isArray(spec.elements) ? spec.elements : [];
    const { pts: raw } = resolvePoints(spec.points || {});
    const getRaw = n => { if (Array.isArray(n)) return n.map(Number); if (!raw[n]) throw new FigureError(`Точка «${n}» не задана в "points"`); return raw[n]; };

    // проекция 3D → 2D
    const frontal = spec.projection === 'frontal';
    const project = p => {
      if (view !== 'solid') return [p[0], p[1]];
      const q = pad3(p);
      if (frontal) return [q[0], q[2] + q[1] * 0.3];
      return [q[0] + q[1] * 0.5 * Math.SQRT1_2, q[2] + q[1] * 0.5 * Math.SQRT1_2];
    };
    const P = {}; Object.keys(raw).forEach(k => { P[k] = project(raw[k]); });
    const pt = n => (Array.isArray(n) ? project(n.map(Number)) : (P[n] || getRaw(n)));

    // ---- охват в мировых координатах ----
    const ext = [];
    const coord = view === 'coord' ? Object.assign({ x: [-5, 5], y: [-5, 5], grid: true }, spec.coord || {}) : null;
    if (coord) { ext.push([coord.x[0], coord.y[0]], [coord.x[1], coord.y[1]]); }
    else {
      Object.keys(P).forEach(k => { if (!(spec.hidden || []).includes(k)) ext.push(P[k]); });
      elements.forEach(el => {
        if (el.type === 'circle') { const c = pt(el.center), r = el.radius != null ? +el.radius : len(sub(pt(el.through), c)); ext.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
        if (el.type === 'circumcircle') { const [a, b, c] = el.points.map(pt), o = circumcenter(a, b, c), r = len(sub(a, o)); ext.push([o[0] - r, o[1] - r], [o[0] + r, o[1] + r]); }
        if (el.type === 'sphere') { const c = pt(el.center), r = +el.radius; ext.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
        if (el.type === 'base') { const c = pad3(getRaw(el.center)), r = +el.radius; for (let t = 0; t < 360; t += 30) ext.push(project([c[0] + r * Math.cos(rad(t)), c[1] + r * Math.sin(rad(t)), c[2]])); }
        if (el.type === 'text' && Array.isArray(el.at)) ext.push(project(el.at.map(Number)));
      });
    }
    if (!ext.length) throw new FigureError('На рисунке нет ни одной точки');
    let minx = Math.min(...ext.map(p => p[0])), maxx = Math.max(...ext.map(p => p[0]));
    let miny = Math.min(...ext.map(p => p[1])), maxy = Math.max(...ext.map(p => p[1]));
    if (maxx - minx < 1e-9) { minx -= 1; maxx += 1; }
    if (maxy - miny < 1e-9) { miny -= 1; maxy += 1; }

    // ---- масштаб ----
    const small = !!opts.small;
    const pad = coord ? 34 : (small ? 34 : 46);
    const maxW = small ? 420 : 640, maxH = small ? 320 : 460;
    const s = Math.min((maxW - 2 * pad) / (maxx - minx), (maxH - 2 * pad) / (maxy - miny));
    let W = Math.round((maxx - minx) * s + 2 * pad), H = Math.round((maxy - miny) * s + 2 * pad);
    const minW = small ? 260 : 380, minH = small ? 170 : 220;
    const offX = W < minW ? (minW - W) / 2 : 0, offY = H < minH ? (minH - H) / 2 : 0;
    W = Math.max(W, minW); H = Math.max(H, minH);
    const M = p => [offX + pad + (p[0] - minx) * s, H - offY - pad - (p[1] - miny) * s];
    const S = {}; Object.keys(P).forEach(k => { S[k] = M(P[k]); });
    const sp = n => (Array.isArray(n) ? M(project(n.map(Number))) : (S[n] || M(pt(n))));
    const allPts = Object.keys(S).filter(k => !(spec.hidden || []).includes(k));
    const centroid = allPts.length ? mul(allPts.reduce((a, k) => add(a, S[k]), [0, 0]), 1 / allPts.length) : [W / 2, H / 2];

    const under = [], body = [], over = [];
    const obstacles = []; // отрезки на экране для размещения подписей
    const labelBoxes = [];
    const col = c => COLORS[c] || (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : COLORS.main);
    const strokeAttr = el => `stroke="${col(el.color)}" stroke-width="${el.color === 'aux' ? 1.5 : (el.bold ? 3 : 2.2)}"${el.dashed ? ' stroke-dasharray="7 5"' : ''} stroke-linecap="round" fill="none"`;
    const line = (a, b, el) => { obstacles.push([a, b]); return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" ${strokeAttr(el)}/>`; };
    const poly = (ps, el, closed) => {
      for (let i = 0; i + 1 < ps.length; i++) obstacles.push([ps[i], ps[i + 1]]);
      if (closed && ps.length > 2) obstacles.push([ps[ps.length - 1], ps[0]]);
      return `<${closed ? 'polygon' : 'polyline'} points="${ps.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" ${strokeAttr(el)} stroke-linejoin="round"/>`;
    };
    const placeText = (anchorPt, normal, t, size, color, italic) => {
      // подпись рядом с точкой, по нормали; пробуем две стороны и несколько расстояний
      const w = textWidth(t, size), h = size + 2;
      let best = null;
      [1, -1].forEach(sg => [0, 6, 12].forEach(extra => {
        const d = size * 0.7 + 6 + extra + Math.abs(normal[0]) * w * 0.35;
        const c = [anchorPt[0] + normal[0] * d * sg, anchorPt[1] + normal[1] * d * sg];
        const box = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2];
        let cost = extra * 2 + (sg === 1 ? 0 : 8);
        obstacles.forEach(([a, b]) => { if (segBoxHit(a, b, box)) cost += 60; });
        labelBoxes.forEach(b => { if (boxHit(b, box)) cost += 120; });
        if (box[0] < 2 || box[1] < 2 || box[2] > W - 2 || box[3] > H - 2) cost += 200;
        if (!best || cost < best.cost) best = { cost, c, box };
      }));
      labelBoxes.push(best.box);
      return textSvg(best.c[0], best.c[1], t, { size, color, italic });
    };
    const segLabels = [];

    // ---- координатная плоскость ----
    if (coord) {
      const step = coord.step || ((coord.x[1] - coord.x[0]) > 14 || (coord.y[1] - coord.y[0]) > 14 ? 2 : 1);
      const o = M([0, 0]);
      if (coord.grid !== false) {
        for (let x = Math.ceil(coord.x[0]); x <= coord.x[1]; x++) { const a = M([x, coord.y[0]]), b = M([x, coord.y[1]]); under.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#e3e3e8" stroke-width="1"/>`); }
        for (let y = Math.ceil(coord.y[0]); y <= coord.y[1]; y++) { const a = M([coord.x[0], y]), b = M([coord.x[1], y]); under.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#e3e3e8" stroke-width="1"/>`); }
      }
      const ax = (a, b) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#111" stroke-width="1.6" marker-end="url(#arr)"/>`;
      if (coord.y[0] <= 0 && coord.y[1] >= 0) { under.push(ax(M([coord.x[0], 0]), [M([coord.x[1], 0])[0] + 18, o[1]])); under.push(textSvg(M([coord.x[1], 0])[0] + 14, o[1] + 16, 'x', { size: 17, italic: true })); }
      if (coord.x[0] <= 0 && coord.x[1] >= 0) { under.push(ax(M([0, coord.y[0]]), [o[0], M([0, coord.y[1]])[1] - 18])); under.push(textSvg(o[0] - 14, M([0, coord.y[1]])[1] - 12, 'y', { size: 17, italic: true })); }
      if (coord.numbers !== false) {
        for (let x = Math.ceil(coord.x[0] / step) * step; x <= coord.x[1]; x += step) if (x !== 0) { const p = M([x, 0]); under.push(`<line x1="${p[0]}" y1="${p[1] - 4}" x2="${p[0]}" y2="${p[1] + 4}" stroke="#111"/>`); under.push(textSvg(p[0], p[1] + 15, String(x).replace('-', '−'), { size: 13 })); }
        for (let y = Math.ceil(coord.y[0] / step) * step; y <= coord.y[1]; y += step) if (y !== 0) { const p = M([0, y]); under.push(`<line x1="${p[0] - 4}" y1="${p[1]}" x2="${p[0] + 4}" y2="${p[1]}" stroke="#111"/>`); under.push(textSvg(p[0] - 12, p[1], String(y).replace('-', '−'), { size: 13, anchor: 'end' })); }
        under.push(textSvg(o[0] - 10, o[1] + 14, 'O', { size: 15, italic: true }));
      }
    }

    // ---- элементы ----
    for (const el of elements) {
      const t = el.type;
      if (t === 'polygon') {
        const ps = (el.points || []).map(sp);
        if (ps.length < 3) throw new FigureError('polygon: нужно минимум 3 точки');
        if (el.fill) {
          const fc = el.fill === 'gray' ? '#8e8e93' : (COLORS[el.fill] || COLORS.accent);
          under.push(`<polygon points="${ps.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${fc}" fill-opacity="0.1" stroke="none"/>`);
        }
        body.push(poly(ps, el, true));
      } else if (t === 'segment' || t === 'vector') {
        const a = sp(el.from), b = sp(el.to);
        body.push(line(a, b, el));
        if (t === 'vector') {
          const d = sub(b, a), L = len(d) || 1, u = mul(d, 1 / L), n = [-u[1], u[0]];
          const h1 = add(sub(b, mul(u, 13)), mul(n, 5)), h2 = sub(sub(b, mul(u, 13)), mul(n, 5));
          body.push(`<polygon points="${b.join(',')} ${h1.join(',')} ${h2.join(',')}" fill="${col(el.color)}"/>`);
        }
        if (el.ticks) {
          const d = sub(b, a), L = len(d) || 1, u = mul(d, 1 / L), n = [-u[1], u[0]], m = mul(add(a, b), 0.5);
          for (let k = 0; k < el.ticks; k++) { const c = add(m, mul(u, (k - (el.ticks - 1) / 2) * 5)); over.push(`<line x1="${(c[0] + n[0] * 7).toFixed(1)}" y1="${(c[1] + n[1] * 7).toFixed(1)}" x2="${(c[0] - n[0] * 7).toFixed(1)}" y2="${(c[1] - n[1] * 7).toFixed(1)}" stroke="${col(el.color)}" stroke-width="2"/>`); }
        }
        if (el.label != null && el.label !== '') segLabels.push({ a, b, label: String(el.label), color: el.labelColor || (el.color === 'accent' ? 'accent' : 'main'), vector: t === 'vector' });
      } else if (t === 'line' || t === 'ray') {
        const a = t === 'ray' ? sp(el.from) : sp(el.through[0]), b = t === 'ray' ? sp(el.through) : sp(el.through[1]);
        const r = clipLineToRect(a, sub(b, a), W, H, t === 'ray');
        if (r) body.push(line(r[0], r[1], el));
        if (el.label) { const end = r ? r[1] : b; over.push(textSvg(end[0] - 12, end[1] - 12, el.label, { size: 17, italic: true })); }
      } else if (t === 'circle' || t === 'circumcircle' || t === 'incircle') {
        let c, r;
        if (t === 'circle') { c = pt(el.center); r = el.radius != null ? +el.radius : len(sub(pt(el.through), c)); }
        else { const [a, b, cc] = el.points.map(pt); c = t === 'incircle' ? incenter(a, b, cc) : circumcenter(a, b, cc); r = t === 'incircle' ? inradius(a, b, cc) : len(sub(a, c)); }
        const C = M(c), R = r * s, ps = [];
        for (let k = 0; k <= 72; k++) ps.push([C[0] + R * Math.cos(k * Math.PI / 36), C[1] + R * Math.sin(k * Math.PI / 36)]);
        for (let k = 0; k < 72; k++) obstacles.push([ps[k], ps[k + 1]]);
        body.push(`<circle cx="${C[0].toFixed(1)}" cy="${C[1].toFixed(1)}" r="${R.toFixed(1)}" ${strokeAttr(el)}/>`);
      } else if (t === 'arc') {
        const C = sp(el.center), A = sp(el.from), B = sp(el.to), R = len(sub(A, C));
        const a1 = Math.atan2(A[1] - C[1], A[0] - C[0]); let a2 = Math.atan2(B[1] - C[1], B[0] - C[0]);
        // дуга против часовой стрелки в математическом смысле = по часовой на экране
        let sweep = a1 - a2; while (sweep < 0) sweep += 2 * Math.PI;
        const ps = []; for (let k = 0; k <= 48; k++) { const an = a1 - sweep * k / 48; ps.push([C[0] + R * Math.cos(an), C[1] + R * Math.sin(an)]); }
        body.push(poly(ps, el, false));
      } else if (t === 'angle' || t === 'right') {
        const V = sp(el.at), A = sp(el.from), B = sp(el.to);
        const ua = mul(sub(A, V), 1 / (len(sub(A, V)) || 1)), ub = mul(sub(B, V), 1 / (len(sub(B, V)) || 1));
        const color = col(el.color || (t === 'angle' ? 'main' : 'main'));
        if (t === 'right') {
          const k = 12, p1 = add(V, mul(ua, k)), p2 = add(add(V, mul(ua, k)), mul(ub, k)), p3 = add(V, mul(ub, k));
          over.push(`<polyline points="${[p1, p2, p3].map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
          continue;
        }
        const minSide = Math.min(len(sub(A, V)), len(sub(B, V)));
        const r0 = Math.max(14, Math.min(26, minSide * 0.35));
        const a1 = Math.atan2(ua[1], ua[0]), a2 = Math.atan2(ub[1], ub[0]);
        let d = a2 - a1; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
        const arcs = Math.max(1, Math.min(3, el.arcs || 1));
        for (let k = 0; k < arcs; k++) {
          const r = r0 + k * 5, ps = [];
          for (let j = 0; j <= 24; j++) { const an = a1 + d * j / 24; ps.push([V[0] + r * Math.cos(an), V[1] + r * Math.sin(an)]); }
          over.push(`<polyline points="${ps.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
        }
        if (el.fill) { const ps = [V]; for (let j = 0; j <= 24; j++) { const an = a1 + d * j / 24; ps.push([V[0] + r0 * Math.cos(an), V[1] + r0 * Math.sin(an)]); } under.push(`<polygon points="${ps.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${color}" fill-opacity="0.15"/>`); }
        if (el.label != null && el.label !== '') {
          const bis = a1 + d / 2, lr = r0 + (arcs - 1) * 5 + 8 + textWidth(el.label, 16) * 0.42;
          const c = [V[0] + lr * Math.cos(bis), V[1] + lr * Math.sin(bis)];
          const w = textWidth(el.label, 16);
          labelBoxes.push([c[0] - w / 2, c[1] - 9, c[0] + w / 2, c[1] + 9]);
          over.push(textSvg(c[0], c[1], el.label, { size: 16, color: col(el.labelColor || el.color) }));
        }
      } else if (t === 'point') {
        // точки рисуются ниже, здесь только отметка о видимости
      } else if (t === 'text') {
        const p = Array.isArray(el.at) ? M(project(el.at.map(Number))) : sp(el.at);
        const q = [p[0] + (+el.dx || 0), p[1] - (+el.dy || 0)];
        const w = textWidth(el.text, el.size || 17);
        labelBoxes.push([q[0] - w / 2, q[1] - 10, q[0] + w / 2, q[1] + 10]);
        over.push(textSvg(q[0], q[1], el.text, { size: el.size || 17, italic: !!el.italic, color: col(el.color) }));
      } else if (t === 'function') {
        if (!coord) throw new FigureError('function: графики рисуются только при "view": "coord"');
        const f = compileExpr(el.expr), dom = el.domain || coord.x, n = 400, segs = [[]];
        for (let k = 0; k <= n; k++) {
          const x = dom[0] + (dom[1] - dom[0]) * k / n; let y;
          try { y = f(x); } catch (e) { y = NaN; }
          const ok = isFinite(y) && y >= coord.y[0] - 0.5 && y <= coord.y[1] + 0.5;
          if (ok) segs[segs.length - 1].push(M([x, Math.max(coord.y[0], Math.min(coord.y[1], y))]));
          else if (segs[segs.length - 1].length) segs.push([]);
        }
        segs.filter(g => g.length > 1).forEach(g => body.push(poly(g, Object.assign({ color: 'accent' }, el), false)));
        if (el.label) { const g = segs.filter(g => g.length > 1).pop(); if (g) { const e = g[g.length - 1]; over.push(textSvg(Math.min(W - 40, e[0] + 6), Math.max(14, e[1] - 12), el.label, { size: 16, color: col(el.color || 'accent'), anchor: 'end' })); } }
      } else if (t === 'base') {
        if (view !== 'solid') throw new FigureError('base: окружность основания нужна только при "view": "solid"');
        const c = pad3(getRaw(el.center)), r = +el.radius, front = [], back = [];
        for (let k = 0; k <= 96; k++) {
          const an = k * Math.PI / 48, q = M(project([c[0] + r * Math.cos(an), c[1] + r * Math.sin(an), c[2]]));
          (Math.sin(an) > 1e-9 && el.back !== 'solid' ? back : front).push([q, k]);
        }
        const chain = arr => { const out = []; let cur = []; arr.forEach(([q, k], i) => { if (i && k !== arr[i - 1][1] + 1) { out.push(cur); cur = []; } cur.push(q); }); if (cur.length) out.push(cur); return out; };
        chain(front).forEach(g => g.length > 1 && body.push(poly(g, el, false)));
        chain(back).forEach(g => g.length > 1 && body.push(poly(g, Object.assign({}, el, { dashed: true }), false)));
      } else if (t === 'sphere') {
        const C = M(pt(el.center)), R = +el.radius * s;
        body.push(`<circle cx="${C[0].toFixed(1)}" cy="${C[1].toFixed(1)}" r="${R.toFixed(1)}" ${strokeAttr(el)}/>`);
        if (el.equator !== false) {
          const ry = R * 0.3;
          body.push(`<path d="M ${C[0] - R} ${C[1]} A ${R} ${ry} 0 0 0 ${C[0] + R} ${C[1]}" stroke="${col(el.color)}" stroke-width="2" fill="none"/>`);
          body.push(`<path d="M ${C[0] - R} ${C[1]} A ${R} ${ry} 0 0 1 ${C[0] + R} ${C[1]}" stroke="${col(el.color)}" stroke-width="1.6" stroke-dasharray="7 5" fill="none"/>`);
        }
      } else {
        throw new FigureError(`Неизвестный элемент "${t}"`);
      }
    }

    // ---- подписи отрезков: снаружи фигуры ----
    segLabels.forEach(({ a, b, label, color, vector }) => {
      const m = mul(add(a, b), 0.5), d = sub(b, a), L = len(d) || 1;
      let n = [-d[1] / L, d[0] / L];
      if (dot(n, sub(m, centroid)) < 0) n = mul(n, -1);
      const txt = vector ? label + '⃗' : label;
      over.push(placeText(m, n, txt, 17, col(color), vector));
    });

    // ---- точки и их подписи ----
    const named = allPts.filter(k => !/^_/.test(k));
    const visible = spec.labels === false ? [] : named;
    const dotsFor = spec.dots === 'all' ? named : (spec.dots || []);
    const dots = new Set(dotsFor);
    elements.filter(e => e.type === 'point').forEach(e => dots.add(e.at));
    dots.forEach(k => { if (S[k]) over.push(`<circle cx="${S[k][0].toFixed(1)}" cy="${S[k][1].toFixed(1)}" r="3.4" fill="${COLORS.main}"/>`); });
    // точки, лежащие на линиях, — маленький кружок, чтобы было видно положение
    visible.forEach(k => {
      const p = S[k], label = (spec.names && spec.names[k]) || k;
      const w = textWidth(label, 19), h = 22;
      let best = null;
      for (let j = 0; j < 16; j++) {
        const an = j * Math.PI / 8, dist = 15 + Math.abs(Math.cos(an)) * w * 0.28;
        const c = [p[0] + dist * Math.cos(an), p[1] + dist * Math.sin(an)];
        const box = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2];
        const out = sub(p, centroid), ol = len(out);
        let cost = ol > 1 ? -18 * (Math.cos(an) * out[0] + Math.sin(an) * out[1]) / ol : 0;
        obstacles.forEach(([a, b]) => { if (segBoxHit(a, b, box)) cost += 70; });
        labelBoxes.forEach(bx => { if (boxHit(bx, box)) cost += 140; });
        allPts.forEach(q => { if (q !== k && S[q][0] > box[0] - 4 && S[q][0] < box[2] + 4 && S[q][1] > box[1] - 4 && S[q][1] < box[3] + 4) cost += 90; });
        if (box[0] < 1 || box[1] < 1 || box[2] > W - 1 || box[3] > H - 1) cost += 300;
        if (!best || cost < best.cost) best = { cost, c, box };
      }
      labelBoxes.push(best.box);
      over.push(textSvg(best.c[0], best.c[1], label, { size: 19, italic: true }));
    });

    const defs = coord ? '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="#111"/></marker></defs>' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}<rect width="${W}" height="${H}" fill="#ffffff"/>${under.join('')}${body.join('')}${over.join('')}</svg>`;
  }

  // проверка без отрисовки (для «Код рисунка»)
  function validate(spec) { const r = render(spec); return r.error || null; }

  // SVG → PNG заданной ширины на белом фоне
  function svgToPng(svg, width) {
    return new Promise((resolve, reject) => {
      const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
      const w0 = m ? +m[1] : 600, h0 = m ? +m[2] : 400, k = width / w0;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => (b ? resolve({ blob: b, width: c.width, height: c.height }) : reject(new Error('PNG не создан'))), 'image/png');
      };
      img.onerror = () => reject(new Error('Не удалось растеризовать рисунок'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  window.Figure = { render, validate, svgToPng, compileExpr };
})();
