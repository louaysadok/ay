/**
 * Tractor.js — terminal tractor unit (yard truck) with an optional trailer.
 *
 * Deliberately simpler than the lifting machines: the tractor does not raise
 * or lower anything. It couples to a yard trailer, and once coupled it can
 * collect a container that has been set down onto the trailer by a crane —
 * which is how a real terminal moves boxes over distance. Safety focus:
 * stopping distance grows a lot when the trailer is loaded.
 */
import { Vehicle } from './Vehicle.js';
import { clamp, damp, dist } from '../engine/Utils.js';

export class Tractor extends Vehicle {
  constructor(spec, opts = {}) {
    super(spec, opts);
    this.coupled = false;
    this.trailer = null;          // the trailer object this unit is towing
    this.trailerEmpty = true;
    this.couplingRange = 4.2;
    this.airPressure = 1;         // brakes are pneumatic — builds up when stationary
    this.jackknife = 0;           // 0..1 warning when reversing too sharply
  }

  get attachment() { return 'trailer'; }
  get capacity() { return this.spec.capacity; }
  /** The trailer deck sits behind the cab. */
  get trailerOffset() { return -(this.spec.length * 0.5 + this.spec.length * 0.62); }

  trailerPoint() {
    const p = this.localToWorld(this.trailerOffset, 0);
    return { x: p.x, y: p.y, angle: this.angle };
  }

  updateAxes(dt, controls) {
    // pneumatic brake reservoir: pumping the brake while stopped restores it
    if (Math.abs(this.speed) < 0.4) this.airPressure = clamp(this.airPressure + dt * 0.35, 0, 1);
    else this.airPressure = clamp(this.airPressure - dt * 0.05, 0.35, 1);

    // interact is resolved by Game (discrete action), not polled here

    // trailer pushes the unit in a turn — visual yaw nudge, never a failure
    if (this.coupled) {
      this.jackknife = damp(this.jackknife, clamp(Math.abs(this.steer) * Math.abs(this.speed) / 4, 0, 1), 3, dt);
      this.yawRate += Math.sign(this.steer) * this.jackknife * 0.05 * Math.sign(this.speed || 1);
    } else {
      this.jackknife = damp(this.jackknife, 0, 4, dt);
    }
    this.trailerEmpty = !(this.trailer?.cargo);
  }

  /** Interact is a coupling action, not a lift. */
  toggleCoupling() {
    if (!this.terminal) return;
    if (this.coupled && this.trailer) {
      this.trailer.towedBy = null;
      this.trailer = null;
      this.coupled = false;
      this.trailerEmpty = true;
      this.emitter?.emit('machine:uncouple', { vehicle: this });
      return;
    }
    const hook = this.trailerPoint();
    // the kingpin is at the front of the trailer, `back` metres ahead of the deck centre
    const near = this.terminal.trailers?.find((t) => {
      if (t.towedBy) return false;
      const back = t.length / 2 + 1.1;
      const pin = { x: t.x + Math.cos(t.angle) * back, y: t.y + Math.sin(t.angle) * back };
      return dist(pin.x, pin.y, hook.x, hook.y) < this.couplingRange;
    });
    if (near) {
      // stand just ahead of the trailer's kingpin, as a driver would
      this.trailer = near;
      near.towedBy = this.id;
      this.coupled = true;
      this.trailerEmpty = !near.cargo;
      this.emitter?.emit('machine:couple', { vehicle: this, trailer: near });
      return;
    }
    this.emitter?.emit('machine:error', { vehicle: this, text: 'No trailer within reach of the coupling.' });
  }

  /** The deck of the coupled trailer — where cargo rides. */
  deckCargo() { return this.trailer?.cargo || null; }

  /** Tractor adopts a load only when one has been set down on its trailer. */
  gripPoint() {
    const p = this.trailerPoint();
    return { x: p.x, y: p.y, angle: this.angle };
  }
  pickupPoint() { return this.gripPoint(); }
  releasePoint() { return this.gripPoint(); }

  attachmentCheck(cargo) {
    if (!this.coupled) return { ok: false, code: 'attachment', message: 'Couple to a trailer first.' };
    if (cargo.weight > this.capacity) {
      return { ok: false, code: 'capacity', message: `Rated for ${this.capacity} t on the trailer.` };
    }
    return { ok: true };
  }

  /** Braking cue used by the HUD: distance needed at the current speed. */
  stoppingDistance() {
    const v = Math.abs(this.speed);
    const loadFactor = this.load ? 2.1 : 1.35;
    return (v * v) / (2 * this.spec.brakeForce * loadFactor);
  }

  get actions() {
    return [
      { id: 'interact', icon: 'hook', label: this.coupled ? 'Uncouple' : 'Couple', primary: true },
      { id: 'brake', icon: 'brake', label: 'Brake' },
      { id: 'horn', icon: 'horn', label: 'Horn' }
    ];
  }

  drawState() {
    return {
      coupled: this.coupled,
      trailerEmpty: this.trailerEmpty,
      jackknife: this.jackknife,
      trailerId: this.trailer?.id || null
    };
  }
}

export default Tractor;
