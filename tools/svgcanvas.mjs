/**
 * svgcanvas.mjs — a headless Canvas2D shim that records drawing commands and
 * serialises them to SVG (later rasterised to PNG).
 *
 * WHY: this repo has no browser available for automated screenshots, so art and
 * renderers are verified by replaying them through this recorder. It implements
 * the subset of Canvas2D the game uses (paths, gradients, transforms, text,
 * alpha, drawImage-of-canvas replay, clipping via clipPath).
 */
import fs from 'node:fs';

const GEN = { fonts: new Set() };

class Gradient {
  constructor(kind, args, ctx) {
    this.kind = kind; this.args = args; this.stops = []; this.id = `g${Gradient.n++}`;
  }
  addColorStop(p, c) { this.stops.push([Math.max(0, Math.min(1, p)), normColor(c)]); }
}
Gradient.n = 1;

function normColor(c) {
  if (typeof c !== 'string') return '#000000';
  return c.trim();
}

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

class Path {
  constructor() { this.d = ''; this.sub = null; }
  moveTo(x, y) { this.d += `M${f(x)} ${f(y)}`; this.sub = { x, y }; this.cx = x; this.cy = y; }
  lineTo(x, y) { this.d += `L${f(x)} ${f(y)}`; this.cx = x; this.cy = y; }
  quad(x1, y1, x, y) { this.d += `Q${f(x1)} ${f(y1)} ${f(x)} ${f(y)}`; this.cx = x; this.cy = y; }
  bez(x1, y1, x2, y2, x, y) { this.d += `C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)}`; this.cx = x; this.cy = y; }
  close() { this.d += 'Z'; }
  arc(cx, cy, r, a0, a1, ccw) {
    if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) {
      // full circle => two arcs
      const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
      this.d += `M${f(sx)} ${f(sy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r * Math.cos(a0))} ${f(cy - r * Math.sin(a0))}A${f(r)} ${f(r)} 0 1 1 ${f(sx)} ${f(sy)}`;
      this.cx = sx; this.cy = sy; return;
    }
    let sweep = a1 - a0;
    if (ccw) { while (sweep > 0) sweep -= Math.PI * 2; } else { while (sweep < 0) sweep += Math.PI * 2; }
    const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
    const ex = cx + r * Math.cos(a0 + sweep), ey = cy + r * Math.sin(a0 + sweep);
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    const sweepFlag = sweep > 0 ? 1 : 0;
    this.d += `M${f(sx)} ${f(sy)}A${f(r)} ${f(r)} 0 ${large} ${sweepFlag} ${f(ex)} ${f(ey)}`;
    this.cx = ex; this.cy = ey;
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let sweep = a1 - a0;
    if (ccw) { while (sweep > 0) sweep -= Math.PI * 2; } else { while (sweep < 0) sweep += Math.PI * 2; }
    const p = (a) => {
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
    };
    if (Math.abs(sweep) >= Math.PI * 2 - 1e-6) { this.arc(cx, cy, Math.max(rx, ry), a0, a1, ccw); return; }
    const [sx, sy] = p(a0), [ex, ey] = p(a0 + sweep);
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    this.d += `M${f(sx)} ${f(sy)}A${f(rx)} ${f(ry)} ${f(rot)} ${large} ${sweep > 0 ? 1 : 0} ${f(ex)} ${f(ey)}`;
    this.cx = ex; this.cy = ey;
  }
  arcTo(x1, y1, x2, y2, r) {
    const x0 = this.cx ?? x1, y0 = this.cy ?? y1;
    // standard arcTo: find the tangent circle between (x0,y0)->(x1,y1)->(x2,y2)
    const d1x = x0 - x1, d1y = y0 - y1, d2x = x2 - x1, d2y = y2 - y1;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-6 || l2 < 1e-6 || r < 1e-6) { this.lineTo(x1, y1); return; }
    const u1x = d1x / l1, u1y = d1y / l1, u2x = d2x / l2, u2y = d2y / l2;
    const cross = u1x * u2y - u1y * u2x;
    if (Math.abs(cross) < 1e-6) { this.lineTo(x1, y1); return; }
    const theta = Math.acos(Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y)));
    const dist = r / Math.tan(theta / 2);
    const t1x = x1 + u1x * dist, t1y = y1 + u1y * dist;
    const t2x = x1 + u2x * dist, t2y = y1 + u2y * dist;
    if ((this.cx === undefined) || (Math.abs(this.cx - snapT(this, u1x, u1y, dist, x1, x0, y0)) < 0.01)) { /* noop */ }
    this.d += `L${f(t1x)} ${f(t1y)}`;
    const sweepFlag = cross > 0 ? 0 : 1;
    this.d += `A${f(r)} ${f(r)} 0 0 ${sweepFlag} ${f(t2x)} ${f(t2y)}`;
    this.cx = t2x; this.cy = t2y;
  }
}
function snapT() { return NaN; }
const f = (n) => (Math.abs(n) < 1e-4 ? 0 : Math.round(n * 100) / 100);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class RecordingContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.ops = canvas.__ops;
    this.stack = [];
    this.state = defaultState();
    this.path = null;
    this._clipId = null;
  }
  get _s() { return this.state; }

  save() {
    this.stack.push({ ...this.state, m: [...this.state.m], clip: this.state.clip });
  }
  restore() {
    if (this.stack.length) this.state = this.stack.pop();
  }
  translate(x, y) { this.state.m = mul(this.state.m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this.state.m = mul(this.state.m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { this.state.m = mul(this.state.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); }
  transform(a, b, c, d, e, g) { this.state.m = mul(this.state.m, [a, b, c, d, e, g]); }
  setTransform(a, b, c, d, e, g) { this.state.m = [a, b, c, d, e, g]; }
  resetTransform() { this.state.m = [1, 0, 0, 1, 0, 0]; }

  // ---- style setters (plain property emulation) --------------------------
  set fillStyle(v) { this.state.fill = v; } get fillStyle() { return this.state.fill; }
  set strokeStyle(v) { this.state.stroke = v; } get strokeStyle() { return this.state.stroke; }
  set lineWidth(v) { this.state.lw = v; } get lineWidth() { return this.state.lw; }
  set globalAlpha(v) { this.state.alpha = v; } get globalAlpha() { return this.state.alpha; }
  set globalCompositeOperation(v) { this.state.comp = v; } get globalCompositeOperation() { return this.state.comp; }
  set font(v) { this.state.font = v; } get font() { return this.state.font; }
  set textAlign(v) { this.state.align = v; } get textAlign() { return this.state.align; }
  set textBaseline(v) { this.state.baseline = v; } get textBaseline() { return this.state.baseline; }
  set lineCap(v) { this.state.cap = v; } get lineCap() { return this.state.cap; }
  set lineJoin(v) { this.state.join = v; } get lineJoin() { return this.state.join; }
  set filter(v) { this.state.filter = v; } get filter() { return this.state.filter; }
  set imageSmoothingEnabled(v) { this.state.smooth = v; } get imageSmoothingEnabled() { return this.state.smooth; }
  set shadowBlur(v) { } set shadowColor(v) { }
  set miterLimit(v) { } set lineDashOffset(v) { }

  // ---- gradients ---------------------------------------------------------
  createLinearGradient(x0, y0, x1, y1) { const g = new Gradient('linear', [x0, y0, x1, y1], this); this.canvas.__defs.push(g); return g; }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { const g = new Gradient('radial', [x0, y0, r0, x1, y1, r1], this); this.canvas.__defs.push(g); return g; }
  createPattern() { return null; }

  // ---- paths -------------------------------------------------------------
  beginPath() { this.path = new Path(); this.path.cx = undefined; this.path.cy = undefined; }
  moveTo(x, y) { this._p().moveTo(x, y); }
  lineTo(x, y) { this._p().lineTo(x, y); }
  quadraticCurveTo(a, b, x, y) { this._p().quad(a, b, x, y); }
  bezierCurveTo(a, b, c, d, x, y) { this._p().bez(a, b, c, d, x, y); }
  arc(cx, cy, r, a0, a1, ccw) { this._p().arc(cx, cy, r, a0, a1, ccw); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) { this._p().ellipse(cx, cy, rx, ry, rot, a0, a1 ?? a0 + Math.PI * 2, ccw); }
  arcTo(x1, y1, x2, y2, r) { this._p().arcTo(x1, y1, x2, y2, r); }
  closePath() { this._p().close(); }
  rect(x, y, w, h) {
    const p = this._p();
    p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.close();
  }
  roundRect(x, y, w, h, r) {
    const p = this._p();
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    p.moveTo(x + rr, y); p.arcTo(x + w, y, x + w, y + h, rr); p.arcTo(x + w, y + h, x, y + h, rr);
    p.arcTo(x, y + h, x, y, rr); p.arcTo(x, y, x + w, y, rr); p.close();
  }
  _p() { if (!this.path) this.beginPath(); return this.path; }

  fill() { this._paint('fill'); }
  stroke() { this._paint('stroke'); }
  clip() {
    const id = `c${this.canvas.__clipN++}`;
    this.ops.push({ t: 'clipDef', id, d: this.path?.d || '', m: [...this.state.m] });
    this.state.clip = id;
  }

  _paint(mode) {
    const s = this.state;
    const d = this.path?.d || '';
    if (!d) return;
    const paint = mode === 'fill' ? s.fill : s.stroke;
    const op = {
      t: mode === 'fill' ? 'path' : 'path',
      d,
      fill: mode === 'fill' ? this._paintOf(paint) : 'none',
      stroke: mode === 'stroke' ? this._paintOf(paint) : 'none',
      lw: s.lw, alpha: s.alpha, cap: s.cap, join: s.join,
      fillRule: mode === 'fill' && s._evenOdd ? 'evenodd' : 'nonzero',
      clip: s.clip, xform: this._xform(), comp: s.comp
    };
    this.ops.push(op);
  }
  _paintOf(v) {
    if (v instanceof Gradient) return `url(#${v.id})`;
    if (typeof v === 'string') return v;
    return '#000';
  }
  _xform() { return this.state.m; }

  fillRect(x, y, w, h) {
    const s = this.state;
    this.ops.push({
      t: 'rect', x, y, w, h, fill: this._paintOf(s.fill), alpha: s.alpha, clip: s.clip,
      xform: this._xform(), comp: s.comp
    });
    this.path = null;
  }
  strokeRect(x, y, w, h) {
    const s = this.state;
    this.ops.push({
      t: 'srect', x, y, w, h, stroke: this._paintOf(s.stroke), lw: s.lw, alpha: s.alpha,
      clip: s.clip, xform: this._xform()
    });
  }
  clearRect(x, y, w, h) { this.ops.push({ t: 'clear', x, y, w, h, xform: this._xform() }); }

  fillText(text, x, y) {
    const s = this.state;
    if (!text) return;
    const size = parseFontSize(s.font);
    const weight = /(\d00|bold)/.exec(s.font)?.[1] || '400';
    let ay = y;
    if (s.baseline === 'middle') ay = y + size * 0.35;
    else if (s.baseline === 'top') ay = y + size * 0.85;
    this.ops.push({
      t: 'text', text: String(text), x, y: ay, fill: this._paintOf(s.fill),
      size, weight: weight === 'bold' ? '700' : weight, alpha: s.alpha, align: s.align,
      family: fontFamily(s.font), clip: s.clip, xform: this._xform(), mono: /mono/i.test(s.font)
    });
  }
  strokeText(text, x, y) {
    const s = this.state;
    const size = parseFontSize(s.font);
    this.ops.push({
      t: 'text', text: String(text), x, y: y + size * .35, fill: 'none',
      stroke: this._paintOf(s.stroke), lw: s.lw, size, alpha: s.alpha, align: s.align,
      family: fontFamily(s.font), clip: s.clip, xform: this._xform()
    });
  }
  measureText(text) {
    const size = parseFontSize(this.state.font);
    const mono = /mono/i.test(this.state.font);
    const w = String(text).length * size * (mono ? 0.6 : 0.53);
    return { width: w, actualBoundingBoxAscent: size * .72, actualBoundingBoxDescent: size * .2 };
  }
  setLineDash() { }

  drawImage(src, ...a) {
    let dx, dy, dw, dh;
    if (a.length === 2) { dx = a[0]; dy = a[1]; dw = src.width; dh = src.height; }
    else if (a.length === 4) { dx = a[0]; dy = a[1]; dw = a[2]; dh = a[3]; }
    else if (a.length === 8) { dx = a[4]; dy = a[5]; dw = a[6]; dh = a[7]; }
    else return;
    if (!src) return;
    if (src.__isCanvas) {
      this.ops.push({
        t: 'canvas', src, dx, dy, dw, dh,
        sw: src.width, sh: src.height, alpha: this.state.alpha, clip: this.state.clip,
        xform: this._xform(), comp: this.state.comp, filter: this.state.filter
      });
    } else if (src.__href) {
      this.ops.push({
        t: 'image', href: src.__href, dx, dy, dw, dh, alpha: this.state.alpha,
        clip: this.state.clip, xform: this._xform()
      });
    }
  }
  getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; }
  putImageData() { }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
}

function parseFontSize(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return m ? parseFloat(m[1]) : 10;
}
function fontFamily(font) {
  if (/mono/i.test(font || '')) return 'monospace';
  const m = /"([^"]+)"|([A-Za-z ]+),/.exec(font || '');
  return m ? (m[1] || m[2] || 'sans-serif').trim() : 'sans-serif';
}
function defaultState() {
  return {
    fill: '#000', stroke: '#000', lw: 1, alpha: 1, comp: 'source-over', font: '10px sans-serif',
    align: 'start', baseline: 'alphabetic', cap: 'butt', join: 'miter', filter: 'none',
    m: [1, 0, 0, 1, 0, 0], clip: null, smooth: true
  };
}

export class RecordingCanvas {
  constructor(w = 300, h = 150) {
    this.__isCanvas = true;
    this.__ops = [];
    this.__defs = [];
    this.__clipN = 1;
    this.width = w; this.height = h;
    this.style = {};
    this._ctx = new RecordingContext(this);
  }
  getContext() { return this._ctx; }
  toDataURL() { return ''; }
  addEventListener() { }
  removeEventListener() { }
  getBoundingClientRect() { return { x: 0, y: 0, width: this.width, height: this.height, left: 0, top: 0 }; }
}

/* ------------------------------------------------------------ serialiser -- */
/**
 * Serialise a RecordingCanvas tree to SVG.
 * Gradient ids are namespaced per canvas instance (c<k>_g<n>) so embedded
 * sub-canvases can never collide, and canvases flagged with `__tint` are
 * replayed as flat silhouettes (approximating Canvas2D `source-in`).
 */
export function canvasToSvg(canvas, { width = canvas.width, height = canvas.height } = {}) {
  const defs = [];
  const out = [];
  const emitXform = (m) => {
    if (!m) return '';
    const [a, b, c, d, e, g] = m;
    if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && g === 0) return '';
    return `matrix(${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)})`;
  };

  const emitCanvas = (cv, prefix, sink, tint = null) => {
    const local = new Map();     // old grad id -> new id
    const remap = (paint) => {
      if (typeof paint !== 'string') return paint;
      const m = /^url\(#(.+)\)$/.exec(paint);
      if (!m) return tint || paint;
      const oldId = m[1];
      if (!local.has(oldId)) {
        const grad = (cv.__defs || []).find((g) => g.id === oldId);
        if (grad) {
          const newId = `${prefix}_${oldId}`;
          local.set(oldId, newId);
          const stops = grad.stops.map(([p, c]) => `<stop offset="${f(p)}" stop-color="${c}"/>`).join('');
          if (grad.kind === 'linear') {
            const [x0, y0, x1, y1] = grad.args;
            defs.push(`<linearGradient id="${newId}" gradientUnits="userSpaceOnUse" x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}">${stops}</linearGradient>`);
          } else {
            const [x0, y0, r0, x1, y1, r1] = grad.args;
            defs.push(`<radialGradient id="${newId}" gradientUnits="userSpaceOnUse" cx="${f(x1)}" cy="${f(y1)}" r="${f(Math.max(r1, 1))}">${stops}</radialGradient>`);
          }
        } else { local.set(oldId, `${prefix}_${oldId}`); }
      }
      return `url(#${local.get(oldId)})`;
    };

    let childIndex = 0;
    for (const op of cv.__ops) {
      const tr = emitXform(op.xform);
      const clipAttr = op.clip ? ` clip-path="url(#${prefix}_${op.clip})"` : '';
      const alphaAttr = op.alpha < 1 ? ` opacity="${f(op.alpha)}"` : '';
      const trAttr = tr ? ` transform="${tr}"` : '';
      switch (op.t) {
        case 'clipDef': {
          const cd = op;
          const cpId = `${prefix}_${cd.id}`;
          defs.push(`<clipPath id="${cpId}">${
            cd.m && emitXform(cd.m) !== ''
              ? `<path d="${cd.d}" transform="${emitXform(cd.m)}"/>`
              : `<path d="${cd.d}"/>`}</clipPath>`);
          break;
        }
        case 'rect':
          sink.push(`<rect x="${f(op.x)}" y="${f(op.y)}" width="${f(op.w)}" height="${f(op.h)}" fill="${tint || remap(op.fill)}"${alphaAttr}${trAttr}${clipAttr}/>`);
          break;
        case 'srect':
          sink.push(`<rect x="${f(op.x)}" y="${f(op.y)}" width="${f(op.w)}" height="${f(op.h)}" fill="none" stroke="${tint || remap(op.stroke)}" stroke-width="${f(op.lw)}"${alphaAttr}${trAttr}${clipAttr}/>`);
          break;
        case 'path':
          sink.push(`<path d="${op.d}" fill="${tint || remap(op.fill)}"${
            op.stroke && op.stroke !== 'none' ? ` stroke="${tint || remap(op.stroke)}" stroke-width="${f(op.lw)}" stroke-linecap="${op.cap}" stroke-linejoin="${op.join}"` : ''
          }${alphaAttr}${trAttr}${clipAttr} fill-rule="${op.fillRule}"/>`);
          break;
        case 'text': {
          const anchor = op.align === 'center' ? 'middle' : op.align === 'right' || op.align === 'end' ? 'end' : 'start';
          if (tint) break;
          sink.push(`<text x="${f(op.x)}" y="${f(op.y)}" font-size="${f(op.size)}" font-weight="${op.weight}" font-family="${op.family}" fill="${remap(op.fill)}"${
            op.stroke ? ` stroke="${remap(op.stroke)}" stroke-width="${f(op.lw)}"` : ''} text-anchor="${anchor}"${alphaAttr}${trAttr}${clipAttr}>${esc(op.text)}</text>`);
          break;
        }
        case 'canvas': {
          const sub = [];
          const subTint = tint || op.src.__tint || null;
          emitCanvas(op.src, `c${childIndex++}_${prefix}`, sub, subTint);
          const sx = op.dw / (op.sw || 1), sy = op.dh / (op.sh || 1);
          const needsScale = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
          sink.push(`<g${alphaAttr}${trAttr}${clipAttr}><g transform="translate(${f(op.dx)} ${f(op.dy)})${needsScale ? ` scale(${f(sx)} ${f(sy)})` : ''}">${sub.join('')}</g></g>`);
          break;
        }
        default: break;
      }
    }
  };

  emitCanvas(canvas, 'r', out);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
<defs>${defs.join('')}</defs>
${out.join('\n')}
</svg>`;
}

/* --------------------------------------------------------------- install -- */
export function installDOM({ width = 1600, height = 900 } = {}) {
  const keyHandlers = [];
  const el = (tag) => ({
    tagName: tag, style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, focus() {}, blur() {}, getBoundingClientRect() { return { x: 0, y: 0, width, height, left: 0, top: 0 }; },
    getContext() { return new RecordingContext(new RecordingCanvas(width, height)); }
  });
  const canvases = [];
  global.document = {
    createElement(tag) {
      if (tag === 'canvas') { const c = new RecordingCanvas(300, 150); canvases.push(c); return c; }
      return el(tag);
    },
    getElementById() { return el('div'); },
    querySelector() { return el('div'); },
    querySelectorAll() { return []; },
    addEventListener(t, fn) { if (t === 'keydown') keyHandlers.push(fn); },
    removeEventListener() { },
    body: el('body'), documentElement: el('html'),
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
    visibilityState: 'visible'
  };
  global.window = {
    innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: memStore(),
    document: global.document, navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0, getGamepads: () => [] },
    location: { href: 'http://localhost/' }
  };
  try { Object.defineProperty(global, 'navigator', { value: global.window.navigator, configurable: true }); } catch { /* node exposes a read-only navigator */ }
  global.localStorage = global.window.localStorage;
  global.requestAnimationFrame = global.window.requestAnimationFrame;
  global.cancelAnimationFrame = global.window.cancelAnimationFrame;
  global.performance = global.performance || { now: () => Date.now() };
  global.__keyHandlers = keyHandlers;
  return { canvases };
}

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

export { RecordingContext as Canvas2DContext };
export function writeSvg(canvas, file, opts) { fs.writeFileSync(file, canvasToSvg(canvas, opts)); }
