/**
 * Collision.js — uniform-grid broadphase + circle/OBB resolution.
 *
 * Everything solid in the terminal (buildings, fences, containers, machinery)
 * is an axis-aligned box. Vehicles resolve as circles against those boxes,
 * which keeps the maths cheap and predictable while still feeling solid.
 */
import { clamp } from './Utils.js';

export const box = (x, y, w, h, meta = {}) => ({ x, y, w, h, ...meta });
export const boxCenter = (x, y, w, h, meta = {}) => ({ x: x - w / 2, y: y - h / 2, w, h, ...meta });

export class CollisionWorld {
  constructor(cellSize = 18) {
    this.cell = cellSize;
    this.cells = new Map();
    this.entries = new Map();     // handle -> {box, cells}
    this._next = 1;
  }

  _key(cx, cy) { return cx * 100000 + cy; }

  _cellRange(b) {
    const c = this.cell;
    return {
      x0: Math.floor(b.x / c), y0: Math.floor(b.y / c),
      x1: Math.floor((b.x + b.w) / c), y1: Math.floor((b.y + b.h) / c)
    };
  }

  /** Register a solid box. `meta.kind` drives how it is treated (hard, cargo, zone…). */
  add(b, meta = {}) {
    const full = { ...b, ...meta };
    const handle = this._next++;
    const r = this._cellRange(full);
    const keys = [];
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const k = this._key(cx, cy);
        keys.push(k);
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(handle);
      }
    }
    this.entries.set(handle, { box: full, keys });
    return handle;
  }

  remove(handle) {
    const e = this.entries.get(handle);
    if (!e) return false;
    for (const k of e.keys) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(handle);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.cells.delete(k);
    }
    this.entries.delete(handle);
    return true;
  }

  /** Replace a box's geometry (e.g. container moved) keeping broadphase valid. */
  update(handle, box) {
    const e = this.entries.get(handle);
    if (!e) return;
    for (const k of e.keys) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(handle);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.cells.delete(k);
    }
    e.box = { ...e.box, ...box };
    const r = this._cellRange(e.box);
    e.keys = [];
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const k = this._key(cx, cy);
        e.keys.push(k);
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(handle);
      }
    }
  }

  get(handle) { return this.entries.get(handle)?.box || null; }

  /** Candidate boxes overlapping a circle (broadphase only). */
  queryCircle(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (const h of arr) {
          if (seen.has(h)) continue;
          seen.add(h);
          const e = this.entries.get(h);
          if (e) out.push(e.box);
        }
      }
    }
    return out;
  }

  queryRect(rect, out = [], filter = null) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor(rect.x / c), x1 = Math.floor((rect.x + rect.w) / c);
    const y0 = Math.floor(rect.y / c), y1 = Math.floor((rect.y + rect.h) / c);
    const seen = this._seen2 || (this._seen2 = new Set());
    seen.clear();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (const h of arr) {
          if (seen.has(h)) continue;
          seen.add(h);
          const e = this.entries.get(h);
          if (!e) continue;
          const b = e.box;
          if (filter && !filter(b)) continue;
          if (b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y) out.push(b);
        }
      }
    }
    return out;
  }

  pointInside(x, y, filter = null) {
    const arr = this.queryCircle(x, y, 0.01, this._tmpA || (this._tmpA = []));
    for (const b of arr) {
      if (filter && !filter(b)) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  /** True if an axis-aligned box is free of obstacles (optionally ignoring some kinds). */
  isFree(x, y, w, h, ignoreKinds = ['marking', 'zone', 'dock', 'lane', 'decal']) {
    const hits = this.queryRect({ x, y, w, h }, this._tmpB || (this._tmpB = []), (b) => !ignoreKinds.includes(b.kind));
    for (const b of hits) {
      if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) return false;
    }
    return true;
  }

  /**
   * Push a circle out of any overlapping box.
   * Returns a contact summary: { pushed:{x,y}, hit:bool, speedInto, box, nx, ny }
   * `vel` is used to compute how hard the impact was (for damage & safety scoring).
   */
  resolveCircle(cx, cy, r, radiusIsSoft = false) {
    const cands = this.queryCircle(cx, cy, r, this._tmpC || (this._tmpC = []));
    let px = 0, py = 0, hitBox = null, bestDepth = 0, nx = 0, ny = 0;
    for (const b of cands) {
      if (b.kind === 'decal' || b.kind === 'marking' || b.kind === 'zone' || b.kind === 'dock' || b.kind === 'lane' || b.kind === 'trigger') continue;
      const qx = clamp(cx, b.x, b.x + b.w);
      const qy = clamp(cy, b.y, b.y + b.h);
      let dx = cx - qx, dy = cy - qy;
      let d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      let d = Math.sqrt(d2), depth, ux, uy;
      if (d > 1e-4) { ux = dx / d; uy = dy / d; depth = r - d; }
      else {
        const dl = cx - b.x, dr = b.x + b.w - cx, dt = cy - b.y, db = b.y + b.h - cy;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) { ux = -1; uy = 0; depth = r + dl; }
        else if (m === dr) { ux = 1; uy = 0; depth = r + dr; }
        else if (m === dt) { ux = 0; uy = -1; depth = r + dt; }
        else { ux = 0; uy = 1; depth = r + db; }
      }
      px += ux * depth; py += uy * depth;
      if (depth > bestDepth) { bestDepth = depth; hitBox = b; nx = ux; ny = uy; }
    }
    return { x: px, y: py, hit: !!hitBox, box: hitBox, depth: bestDepth, nx, ny };
  }

  /** Convenience: is this circle touching anything solid? */
  touching(cx, cy, r, filter = null) {
    const cands = this.queryCircle(cx, cy, r, this._tmpD || (this._tmpD = []));
    for (const b of cands) {
      if (b.kind === 'decal' || b.kind === 'marking' || b.kind === 'zone' || b.kind === 'trigger') continue;
      if (filter && !filter(b)) continue;
      const qx = clamp(cx, b.x, b.x + b.w), qy = clamp(cy, b.y, b.y + b.h);
      if ((cx - qx) ** 2 + (cy - qy) ** 2 <= r * r) return b;
    }
    return null;
  }

  clear() { this.cells.clear(); this.entries.clear(); }
  get size() { return this.entries.size; }
}
export default CollisionWorld;
