/**
 * RTG.js — rubber-tyred gantry crane.
 *
 * Three independent axes: gantry travel (X), trolley across the span (Y) and
 * hoist (Z). Travelling is slow, the trolley runs on rails and the spreader
 * cycles between 20 ft and 40 ft.
 */
import { Vehicle } from './Vehicle.js';
import { clamp, damp } from '../engine/Utils.js';
import { validateLift } from './Container.js';

export class RTG extends Vehicle {
  constructor(spec, opts) {
    super(spec, opts);
    this.trolleyPos = 0.5;             // 0..1 across the span
    this.hoistHeight = 0.15;           // 0 (raised) .. 1 (ground)
    this.spreaderSize = 40;
    this.containerWeight = 0;
  }

  get attachment() { return 'spreader'; }
  get capacity() { return this.spec.capacity; }
  get spreaderFor() { return [this.spreaderSize]; }

  updateAxes(dt, controls) {
    const s = this.spec;
    if (!this.controlLocked) {
      if (controls.auxRight) this.trolleyPos = clamp(this.trolleyPos + s.trolleySpeed * dt * .5, 0, 1);
      if (controls.auxLeft) this.trolleyPos = clamp(this.trolleyPos - s.trolleySpeed * dt * .5, 0, 1);
      if (controls.auxUp) {
        this.hoistHeight = clamp(this.hoistHeight - s.hoistSpeed * dt, 0, 1);
        this.hydraulicPhase += dt * 8;
      }
      if (controls.auxDown) {
        this.hoistHeight = clamp(this.hoistHeight + s.hoistSpeed * dt * 0.8, 0, 1);
        this.hydraulicPhase += dt * 8;
      }
      if (controls.cycle) this.cycleSpreader();
    }
  }

  cycleSpreader() {
    const sizes = this.spec.spreaderSizes || [20, 40];
    const i = sizes.indexOf(this.spreaderSize);
    this.spreaderSize = sizes[(i + 1) % sizes.length];
    this.emitter?.emit('machine:spreader', { vehicle: this, size: this.spreaderSize });
    return this.spreaderSize;
  }

  /** Lateral travel distance of the spreader centre, in metres (across the span). */
  spreaderOffsetY() {
    const half = this.spec.width * 0.5 - 0.9;
    return (this.trolleyPos - 0.5) * 2 * half;
  }

  /** Drop of the spreader below the trolley, metres. */
  hoistDrop() {
    const maxDrop = this.spec.hoistMax ?? 14;
    return 1.0 + this.hoistHeight * (maxDrop - 2.4);
  }

  gripPoint() {
    // the spreader hangs under the trolley; local Y offset, and the load sits
    // on the spreader frame. Hoist height is expressed with a pixel offset in
    // the renderer, so the world grip only shifts laterally.
    const p = this.localToWorld(0, this.spreaderOffsetY());
    return { x: p.x, y: p.y, angle: this.angle };
  }
  pickupPoint() { return this.gripPoint(); }
  releasePoint() { return this.gripPoint(); }
  /** Vertical clearance used for "spreader is down at container level" checks. */
  get spreaderLow() { return this.hoistHeight > 0.62; }

  cabStatus(cargo) {
    if (!this.spreaderLow) return { ok: false, message: 'Lower the hoist: the spreader must be down at container level.' };
    if (cargo.kind === 'container' && !this.spreaderFor.includes(cargo.size)) {
      return { ok: false, message: `Spreader is set for ${this.spreaderSize} ft — press C to cycle it to ${cargo.size} ft.` };
    }
    return { ok: true };
  }

  attachmentCheck(cargo) {
    const res = validateLift(cargo, this);
    if (!res.ok) return res;
    // RTGs stack one-over-four: never lift from a tier that has boxes above it
    if (cargo.slot && this.terminal) {
      const { blockId, bay, row, tier } = cargo.slot;
      const above = this.terminal.slotAt(blockId, bay, row, tier + 1);
      if (above?.container) return { ok: false, code: 'blocked', message: 'A container is stacked on top — lift that one first.' };
    }
    return { ok: true };
  }

  get actions() {
    return [
      { id: 'auxUp', icon: 'up', label: 'Hoist up' },
      { id: 'auxDown', icon: 'down', label: 'Hoist down' },
      { id: 'auxLeft', icon: 'left', label: 'Trolley ◄' },
      { id: 'auxRight', icon: 'right', label: 'Trolley ►' },
      { id: 'cycle', icon: 'spreader', label: `${this.spreaderSize}ft` },
      { id: 'interact', icon: 'hook', label: 'Lock', primary: true }
    ];
  }

  drawState() {
    return {
      trolleyPos: (this.trolleyPos - 0.5) * 2,
      hoistHeight: this.hoistHeight,
      spreaderOffsetY: this.spreaderOffsetY(),
      spreaderLength: this.spreaderSize,
      carrying: !!this.load
    };
  }

  /**
   * A gantry straddles its stacks: only the four legs are solid. (The default
   * hull is two big circles, which would shove the crane out of the yard.)
   */
  get hull() {
    const l = this.spec.length * 0.31, w = this.spec.width * 0.5 - 0.7;
    return [
      { dx: l, dy: w, r: 0.6 }, { dx: l, dy: -w, r: 0.6 },
      { dx: -l, dy: w, r: 0.6 }, { dx: -l, dy: -w, r: 0.6 }
    ];
  }

  /** RTGs must stay inside their block lane. */
  preferredBlock() { return null; }
}

export default RTG;
