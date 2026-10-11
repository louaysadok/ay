/**
 * HarborCrane.js — crawler-mounted mobile harbour crane.
 *
 * Luffing lattice boom with a hook. Horizontal reach is the boom projection;
 * the hook depth is a separate axis. Capacity is expressed as a simple radius
 * chart so players learn that lifting further out lifts less.
 */
import { Vehicle } from './Vehicle.js';
import { clamp, dist } from '../engine/Utils.js';
import { validateLift } from './Container.js';

export class HarborCrane extends Vehicle {
  constructor(spec, opts) {
    super(spec, opts);
    this.boomAngle = 0.22;
    this.hookDepth = 0.25;            // 0 (high) .. 1 (down)
    this.hookAttached = false;
    this.radiusChart = [
      { radius: 12, capacity: 100 },
      { radius: 20, capacity: 64 },
      { radius: 28, capacity: 38 },
      { radius: 36, capacity: 22 }
    ];
  }

  get attachment() { return 'hook'; }
  get capacity() { return this.currentCapacity(); }

  updateAxes(dt, controls) {
    const s = this.spec;
    if (!this.controlLocked) {
      if (controls.auxRight) this.boomAngle = clamp(this.boomAngle + s.luffSpeed * dt, s.luffMin, s.luffMax);
      if (controls.auxLeft) this.boomAngle = clamp(this.boomAngle - s.luffSpeed * dt, s.luffMin, s.luffMax);
      if (controls.auxUp) this.hookDepth = clamp(this.hookDepth - s.hoistSpeed * dt, 0, 1);
      if (controls.auxDown) this.hookDepth = clamp(this.hookDepth + s.hoistSpeed * dt * 0.85, 0, 1);
      if (controls.auxUp || controls.auxDown || controls.auxLeft || controls.auxRight) this.hydraulicPhase += dt * 7;
    }
  }

  /** Horizontal reach from the slew centre, metres. */
  get radius() {
    const boom = this.spec.length * (0.52 + 1.05 * (0.34 - this.boomAngle) / (0.34 + 0.72));
    return Math.max(6, boom);
  }

  /** Capacity available at the current radius (radius chart). */
  currentCapacity() {
    const r = this.radius;
    const chart = this.radiusChart;
    if (r <= chart[0].radius) return chart[0].capacity;
    for (let i = 1; i < chart.length; i++) {
      if (r <= chart[i].radius) {
        const a = chart[i - 1], b = chart[i];
        const t = (r - a.radius) / (b.radius - a.radius);
        return a.capacity + (b.capacity - a.capacity) * t;
      }
    }
    return chart[chart.length - 1].capacity;
  }

  /** Boom tip (hook) position in world space. */
  hookPoint() {
    const pivotX = this.spec.length * 0.46;
    const reach = this.radius;
    const p = this.localToWorld(pivotX + reach, 0);
    return { x: p.x, y: p.y, angle: this.angle };
  }

  gripPoint() { return this.hookPoint(); }
  pickupPoint() { return this.hookPoint(); }
  releasePoint() { return this.hookPoint(); }

  cabStatus(cargo) {
    if (this.hookDepth < 0.5) return { ok: false, message: 'Lower the hook to the load before attaching.' };
    return { ok: true };
  }

  attachmentCheck(cargo) {
    const res = validateLift(cargo, this);
    if (!res.ok) {
      if (res.code === 'attachment') {
        // a hook can handle boxes and general cargo with slings (simplified)
        if (cargo.kind === 'container' || cargo.kind === 'crate') return { ok: true };
      }
      return res;
    }
    const cap = this.currentCapacity();
    if (cargo.weight > cap) {
      return {
        ok: false, code: 'radius',
        message: `At ${this.radius.toFixed(0)} m radius this crane lifts ${cap.toFixed(0)} t. Retract the boom (raise it) or lift closer in.`
      };
    }
    return { ok: true };
  }

  get actions() {
    return [
      { id: 'auxUp', icon: 'up', label: 'Hook up' },
      { id: 'auxDown', icon: 'down', label: 'Hook down' },
      { id: 'auxLeft', icon: 'left', label: 'Boom up' },
      { id: 'auxRight', icon: 'right', label: 'Boom down' },
      { id: 'interact', icon: 'hook', label: 'Attach', primary: true },
      { id: 'horn', icon: 'horn', label: 'Horn' }
    ];
  }

  drawState() {
    // boom extension is expressed through the luff angle for the renderer
    const t = (this.boomAngle - this.spec.luffMin) / (this.spec.luffMax - this.spec.luffMin);
    return {
      boomAngle: this.boomAngle,
      boomExtend: clamp(0.35 + (1 - t) * 0.62, 0, 1),
      hoistHeight: clamp(1 - this.hookDepth, 0, 1),
      hookDrop: 1.1 + this.hookDepth * 1.8,
      radius: this.radius
    };
  }
}

export default HarborCrane;
