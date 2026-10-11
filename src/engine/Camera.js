/**
 * Camera.js — smooth top-down 2D camera with zoom, lead, bounds and shake.
 * Coordinates: world metres (y down). The renderer converts world -> screen.
 */
import { clamp, damp, lerp, rand } from './Utils.js';

export class Camera {
  constructor(opts = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 4.6;                 // pixels per world metre
    this.targetZoom = this.zoom;
    this.minZoom = opts.minZoom ?? 1.35;          // whole terminal visible
    this.maxZoom = opts.maxZoom ?? 13;
    this.vw = 1280; this.vh = 720;                 // viewport size in CSS pixels
    this.bounds = opts.bounds || null;             // {x,y,w,h} world bounds (camera stays inside)
    this.followSmoothing = opts.followSmoothing ?? 5.0;
    this.zoomSmoothing = opts.zoomSmoothing ?? 6.0;
    this.lookAhead = opts.lookAhead ?? 0.55;       // seconds of lead in front of the vehicle
    this.lead = { x: 0, y: 0 };
    this.deadzone = opts.deadzone ?? 0.35;         // metres — ignore micro-jitter
    this._shake = 0; this._shakeT = 0;
    this._panT = 0; this._panDur = 0;
    this._from = { x: 0, y: 0, z: 1 }; this._to = { x: 0, y: 0, z: 1 };
    this._panActive = false;
    this.manual = { x: 0, y: 0 };                  // player nudge (arrow keys / drag)
    this.manualDecay = 1.6;
    this.shakeEnabled = true;
  }

  resize(w, h) { this.vw = w; this.vh = h; }

  /** Effective world-units visible (depends on zoom). */
  get viewW() { return this.vw / this.zoom; }
  get viewH() { return this.vh / this.zoom; }

  setBounds(b) { this.bounds = b; }

  /** Follow a focus point. `lead` is a velocity in m/s supplied by the caller. */
  follow(x, y, dt, vx = 0, vy = 0) {
    const tx = x + vx * this.lookAhead;
    const ty = y + vy * this.lookAhead;
    if (Math.abs(tx - this.x) > this.deadzone) this.x = damp(this.x, tx, this.followSmoothing, dt);
    if (Math.abs(ty - this.y) > this.deadzone) this.y = damp(this.y, ty, this.followSmoothing, dt);
  }

  update(dt) {
    // manual pan offset (keyboard panning / drag), decays back to centre
    if (this.manual.x || this.manual.y) {
      const decay = Math.exp(-this.manualDecay * dt);
      this.manual.x *= decay; this.manual.y *= decay;
      if (Math.abs(this.manual.x) < 0.02) this.manual.x = 0;
      if (Math.abs(this.manual.y) < 0.02) this.manual.y = 0;
    }
    if (this._panActive) {
      this._panT += dt;
      const t = clamp(this._panT / this._panDur, 0, 1);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      this.x = lerp(this._from.x, this._to.x, e);
      this.y = lerp(this._from.y, this._to.y, e);
      this.zoom = lerp(this._from.z, this._to.z, e);
      this.targetZoom = this._to.z;
      if (t >= 1) this._panActive = false;
    } else {
      this.zoom = damp(this.zoom, this.targetZoom, this.zoomSmoothing, dt);
    }
    if (this._shake > 0) {
      this._shakeT += dt;
      this._shake = Math.max(0, this._shake - dt * 2.6);
    }
    this._clampToBounds();
  }

  /** Cinematic move used by missions / cutscene intro. */
  panTo(x, y, zoom = null, dur = 1.4) {
    this._from = { x: this.x, y: this.y, z: this.zoom };
    this._to = { x, y, z: zoom ?? this.zoom };
    this._panT = 0; this._panDur = Math.max(0.05, dur);
    this._panActive = true;
  }
  snapTo(x, y, zoom = null) {
    this._panActive = false;
    this.x = x; this.y = y;
    if (zoom != null) { this.zoom = zoom; this.targetZoom = zoom; }
    this._clampToBounds();
  }
  zoomBy(delta) {
    this.targetZoom = clamp(this.targetZoom * (1 + delta), this.minZoom, this.maxZoom);
  }

  shake(amount = 0.5) {
    if (!this.shakeEnabled) return;
    this._shake = Math.min(1.6, this._shake + amount);
  }
  get shakeOffset() {
    if (this._shake <= 0) return { x: 0, y: 0 };
    const a = this._shake * this._shake * 3.4;
    return { x: rand(a, -a) * 0.42, y: rand(a, -a) * 0.42 };
  }

  _clampToBounds() {
    const b = this.bounds;
    if (!b) return;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    if (b.w <= this.viewW) this.x = b.x + b.w / 2;
    else this.x = clamp(this.x, b.x + hw, b.x + b.w - hw);
    if (b.h <= this.viewH) this.y = b.y + b.h / 2;
    else this.y = clamp(this.y, b.y + hh, b.y + b.h - hh);
  }

  /** World -> screen (device-independent CSS pixels). */
  worldToScreen(wx, wy, out = {}) {
    out.x = (wx - this.x) * this.zoom + this.vw / 2;
    out.y = (wy - this.y) * this.zoom + this.vh / 2;
    return out;
  }
  screenToWorld(sx, sy, out = {}) {
    out.x = (sx - this.vw / 2) / this.zoom + this.x;
    out.y = (sy - this.vh / 2) / this.zoom + this.y;
    return out;
  }
  /** Visible world rectangle, expanded by `pad` metres (for culling). */
  viewRect(pad = 2) {
    return {
      x: this.x - this.viewW / 2 - pad,
      y: this.y - this.viewH / 2 - pad,
      w: this.viewW + pad * 2,
      h: this.viewH + pad * 2
    };
  }
}
export default Camera;
