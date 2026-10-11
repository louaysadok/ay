/**
 * Utils.js — small math / helper toolbox shared by every system.
 * No dependencies. Everything is pure so it is trivially testable.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Move `a` toward `b` by at most `maxDelta`. */
export const approach = (a, b, maxDelta) => {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
};

export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDiff = (a, b) => wrapAngle(b - a);
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
export const deg = (r) => r * RAD;
export const rad = (d) => d * DEG;
export const rotateX = (x, y, a) => x * Math.cos(a) - y * Math.sin(a);
export const rotateY = (x, y, a) => x * Math.sin(a) + y * Math.cos(a);
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** Deterministic PRNG (mulberry32) — used for procedural art & yard layout. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + rng() * (b - a);
  rng.int = (a, b) => Math.floor(a + rng() * (b - a + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.bool = (p = 0.5) => rng() < p;
  return rng;
}

/* ------------------------------------------------------------------ rects -- */
export const rectContains = (r, x, y) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
export const rectCenter = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rectOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rectExpand = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 });
export const rectFromPoints = (x1, y1, x2, y2) => ({
  x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
});
export const roundRectPath = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

/* ----------------------------------------------------------- oriented box -- */
/** Test if a world point lies inside a rotated rectangle (OBB). */
export function pointInOBB(px, py, cx, cy, hw, hh, ang) {
  const dx = px - cx, dy = py - cy;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

/** Separating Axis Theorem test for two oriented boxes. */
export function obbOverlap(a, b) {
  const axes = [
    [Math.cos(a.ang), Math.sin(a.ang)], [-Math.sin(a.ang), Math.cos(a.ang)],
    [Math.cos(b.ang), Math.sin(b.ang)], [-Math.sin(b.ang), Math.cos(b.ang)]
  ];
  for (const [ax, ay] of axes) {
    const ap = projectOBB(a, ax, ay), bp = projectOBB(b, ax, ay);
    if (ap.max < bp.min || bp.max < ap.min) return false;
  }
  return true;
}
function projectOBB(o, ax, ay) {
  const c = Math.cos(o.ang), s = Math.sin(o.ang);
  const ex = Math.abs((o.hw * c) * ax + (o.hw * s) * ay);
  const ey = Math.abs((-o.hh * s) * ax + (o.hh * c) * ay);
  const proj = o.x * ax + o.y * ay;
  return { min: proj - ex - ey, max: proj + ex + ey };
}

/* ---------------------------------------------------------------- random --- */
export function uuid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/* ---------------------------------------------------------------- easing -- */
export const fmtTime = (sec) => {
  if (sec == null || !isFinite(sec)) return '--:--';
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
export const fmtClock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
export const fmtNum = (n) => {
  const v = Math.round(n);
  return v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v);
};
export const roman = (n) => ['I', 'II', 'III', 'IV', 'V'][n - 1] || String(n);

/* ------------------------------------------------------------- colour util -- */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
export function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = (x, y) => Math.round(lerp(x, y, t)).toString(16).padStart(2, '0');
  return `#${c(A.r, B.r)}${c(A.g, B.g)}${c(A.b, B.b)}`;
}
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v + 255 * amount), 0, 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/* ------------------------------------------------------------- collections -- */
export const byId = (arr, id) => arr.find((o) => o.id === id) || null;
export const groupBy = (arr, fn) =>
  arr.reduce((acc, o) => { const k = fn(o); (acc[k] ||= []).push(o); return acc; }, {});

/** Simple ring buffer used by telemetry / FPS graph. */
export class Ring {
  constructor(size = 60) { this.size = size; this.data = new Float32Array(size); this.i = 0; this.filled = 0; }
  push(v) { this.data[this.i] = v; this.i = (this.i + 1) % this.size; this.filled = Math.min(this.filled + 1, this.size); }
  avg() { let s = 0; for (let i = 0; i < this.filled; i++) s += this.data[i]; return this.filled ? s / this.filled : 0; }
  max() { let m = -Infinity; for (let i = 0; i < this.filled; i++) m = Math.max(m, this.data[i]); return m === -Infinity ? 0 : m; }
}
