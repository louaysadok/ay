/**
 * ReachStacker.js — telescopic boom container handler.
 *
 * Extra axes: boom lift (luff), boom extension and a spreader that cycles
 * between 20 ft and 40 ft. Capacity drops in the second row, which is the
 * educational hook for the capacity chart.
 */
import { Vehicle } from './Vehicle.js';
import { clamp, damp, approach, dist } from '../engine/Utils.js';
import { validateLift } from './Container.js';

export class ReachStacker extends Vehicle {
  constructor(spec, opts) {
    super(spec, opts);
    this.boomAngle = 0.26;        // radians, + = raised
    this.boomExtend = 0.05;       // 0..1
    this.spreaderSize = 40;
    this.spreaderLocked = false;
  }

  get attachment() { return 'spreader'; }
  get capacity() { return this.spec.capacity; }
  get spreaderFor() { return [this.spreaderSize]; }

  updateAxes(dt, controls) {
    const s = this.spec;
    if (!this.controlLocked) {
      if (controls.auxUp) this.boomAngle = clamp(this.boomAngle + s.boomLiftSpeed * dt, s.boomMinAngle, s.boomMaxAngle);
      if (controls.auxDown) this.boomAngle = clamp(this.boomAngle - s.boomLiftSpeed * dt, s.boomMinAngle, s.boomMaxAngle);
      if (controls.auxLeft) this.boomExtend = clamp(this.boomExtend + s.boomExtendSpeed * dt, 0, 1);
      if (controls.auxRight) this.boomExtend = clamp(this.boomExtend - s.boomExtendSpeed * dt, 0, 1);
      if (controls.auxUp || controls.auxDown || controls.auxLeft || controls.auxRight) {
        this.hydraulicPhase += dt * 9;
        this.emitter?.emit('machine:hydraulics', { vehicle: this, axis: 'boom' });
      }
      if (controls.cycle) this.cycleSpreader();
    }
    // boom droops slowly under load (visual + teaching cue)
    const loadDrop = this.load ? (this.load.weight / this.spec.capacity) * 0.02 : 0;
    this._boomDisplay = damp(this._boomDisplay ?? this.boomAngle, this.boomAngle - loadDrop, 6, dt);
  }

  cycleSpreader() {
    const sizes = this.spec.spreaderSizes || [20, 40];
    const i = sizes.indexOf(this.spreaderSize);
    this.spreaderSize = sizes[(i + 1) % sizes.length];
    this.emitter?.emit('machine:spreader', { vehicle: this, size: this.spreaderSize });
    return this.spreaderSize;
  }

  /** Boom tip position in local space (metres). */
  boomTipLocal() {
    const pivotX = this.spec.length * ((this.spec.boomPivotX ?? 0.56) - 0.5);   // art is authored from the rear; origin = centre
    const len = this.boomLength();
    return { x: pivotX + Math.cos(this.boomAngle) * len, y: Math.sin(this.boomAngle) * len };
  }
  boomLength() {
    return this.spec.length * 0.42 + this.spec.length * 0.58 * this.boomExtend;
  }

  gripPoint() {
    const t = this.boomTipLocal();
    const p = this.localToWorld(t.x, t.y);
    return { x: p.x, y: p.y, angle: this.angle };
  }
  pickupPoint() { return this.gripPoint(); }
  releasePoint() { return this.gripPoint(); }

  cabStatus(cargo) {
    if (cargo.kind === 'container' && cargo.size !== this.spreaderSize && this.spreaderSize !== 45) {
      // auto-friendly: warn but allow the spreader to be cycled with C
      if (!this.spreaderFor.includes(cargo.size)) {
        return { ok: false, message: `Spreader is set for ${this.spreaderSize} ft — press C to cycle it to ${cargo.size} ft.` };
      }
    }
    return { ok: true };
  }

  attachmentCheck(cargo) {
    const rowTwo = dist(cargo.x, cargo.y, this.x, this.y) > 6.4;
    const cap = rowTwo ? (this.spec.secondRowCapacity ?? this.spec.capacity) : this.spec.capacity;
    const res = validateLift(cargo, this);
    if (!res.ok) return res;
    if (cargo.weight > cap) {
      return {
        ok: false, code: 'capacity-row',
        message: `Second-row lift limited to ${cap} t. This unit is ${cargo.weight.toFixed(1)} t.`
      };
    }
    return { ok: true };
  }

  get actions() {
    return [
      { id: 'auxUp', icon: 'up', label: 'Boom up' },
      { id: 'auxDown', icon: 'down', label: 'Boom down' },
      { id: 'auxLeft', icon: 'right', label: 'Extend' },
      { id: 'auxRight', icon: 'left', label: 'Retract' },
      { id: 'cycle', icon: 'spreader', label: `${this.spreaderSize}ft` },
      { id: 'interact', icon: 'hook', label: 'Lock', primary: true },
      { id: 'horn', icon: 'horn', label: 'Horn' }
    ];
  }

  drawState() {
    return {
      boomAngle: this._boomDisplay ?? this.boomAngle,
      boomExtend: this.boomExtend,
      spreaderLength: this.spreaderSize,
      spreaderLocked: !!this.load
    };
  }
}

export default ReachStacker;
