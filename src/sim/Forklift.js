/**
 * Forklift.js — counterbalance forklift.
 *
 * Extra axes: fork height (0 → 3.1 m, simulated) and side-shift. The load sits
 * on the tines, ahead of the drive axle, so the numbers here also drive the
 * stability feedback the Mentor talks about.
 */
import { Vehicle } from './Vehicle.js';
import { clamp, approach } from '../engine/Utils.js';
import { validateLift } from './Container.js';

export class Forklift extends Vehicle {
  constructor(spec, opts) {
    super(spec, opts);
    this.forkHeight = 0.12;          // metres, 0 = on the ground
    this.forkTarget = 0.12;
    this.sideShift = 0;
    this.tilt = 0;                   // -1 forward, +1 back (visual)
    this.counterweightWarn = 0;
  }

  get attachment() { return 'forks'; }
  get capacity() { return this.spec.capacity; }

  updateAxes(dt, controls) {
    const s = this.spec;
    if (!this.controlLocked) {
      const up = (controls.auxUp ? 1 : 0) - (controls.auxDown ? 1 : 0);
      const lat = (controls.auxRight ? 1 : 0) - (controls.auxLeft ? 1 : 0);
      if (up) this.forkTarget = clamp(this.forkTarget + up * s.forkSpeed * dt, 0, s.forkTravel);
      if (lat) this.sideShift = clamp(this.sideShift + lat * s.sideShiftSpeed ?? lat * 0.45 * dt, -s.sideShift, s.sideShift);
      if (!lat) this.sideShift = approach(this.sideShift, 0, 0.05 * dt);
      this.hydraulicPhase += (up || lat) ? dt * 9 : 0;
    }
    const prev = this.forkHeight;
    this.forkHeight = approach(this.forkHeight, this.forkTarget, s.forkSpeed * dt);
    if (Math.abs(this.forkHeight - prev) > 0.0005) this.emitter?.emit('machine:hydraulics', { vehicle: this, axis: 'fork' });

    // Stability: a raised load + cornering = tip risk (educational feedback)
    const raised = this.forkHeight > 1.35 ? 1 : 0;
    const corner = Math.abs(this.steer) > 0.45 && Math.abs(this.speed) > 1.4;
    if (raised && corner) this.counterweightWarn = Math.min(1, this.counterweightWarn + dt * 1.2);
    else this.counterweightWarn = Math.max(0, this.counterweightWarn - dt * 0.8);
    if (this.counterweightWarn > 0.75 && !this._warned) {
      this._warned = true;
      this.emitter?.emit('safety:unstable', { vehicle: this, reason: 'raised-load-turning' });
      setTimeout(() => { this._warned = false; }, 6000);
    }
  }

  get forkLifted() { return this.forkHeight > 1.35; }

  gripPoint() {
    const s = this.spec;
    const reach = s.length * 0.30 + this.sideShift * 0;
    const p = this.localToWorld(s.length * 0.62 + reach - 0.55, this.sideShift);
    return { x: p.x, y: p.y, angle: this.angle };
  }
  pickupPoint() {
    const s = this.spec;
    const p = this.localToWorld(s.length * 0.62 + s.length * 0.30 - 0.55, this.sideShift);
    return { x: p.x, y: p.y, angle: this.angle };
  }
  releasePoint() { return this.pickupPoint.call(this); }

  attachmentCheck(cargo) {
    if (this.forkHeight > 0.55 && cargo.status !== 'held') {
      return { ok: false, code: 'height', message: 'Lower the forks to the ground before lifting.' };
    }
    const v = validateLift(cargo, this);
    return v;
  }

  cabStatus(cargo) {
    if (cargo.kind === 'container') {
      return { ok: false, message: 'This machine carries forks — containers need a spreader or hook. Try the reach stacker.' };
    }
    if (this.forkHeight > 0.55) return { ok: false, message: 'Lower the forks to the ground before lifting.' };
    return { ok: true };
  }

  get actions() {
    return [
      { id: 'auxUp', icon: 'up', label: 'Raise' },
      { id: 'auxDown', icon: 'down', label: 'Lower' },
      { id: 'interact', icon: 'hook', label: 'Load', primary: true },
      { id: 'horn', icon: 'horn', label: 'Horn' }
    ];
  }

  drawState() {
    return { forkHeight: this.forkHeight, forkSpread: 1, sideShift: this.sideShift, tilt: this.tilt };
  }
}

export default Forklift;
