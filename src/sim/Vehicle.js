/**
 * Vehicle.js — shared machinery physics.
 *
 * A simplified single-track ("bicycle") model tuned per machine, resolved
 * against the terminal collision world at two hull circles so long machines
 * cannot clip through corners. Impacts reduce condition and emit events that
 * the scoring system turns into safety feedback.
 */
import { clamp, damp, approach, wrapAngle, TAU, rand, dist } from '../engine/Utils.js';

export class Vehicle {
  /**
   * @param {object} spec    entry from data/machines.json
   * @param {object} opts    { id, x, y, angle, terminal, bus }
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.type = spec.id;
    this.id = opts.id || spec.id + '-1';
    this.name = spec.short;

    // --- pose -----------------------------------------------------------
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.angle = opts.angle ?? 0;
    this.vx = 0; this.vy = 0;
    this.speed = 0;              // signed, along heading
    this.steer = 0;
    this.yawRate = 0;

    // --- state ----------------------------------------------------------
    this.engineOn = true;
    this.brakeOn = false;
    this.reversing = false;
    this.horn = 0;
    this.condition = 100;        // percentage
    this.load = null;            // cargo held
    this.attachmentLocked = false;
    this.emitter = opts.bus || null;
    this.terminal = opts.terminal || null;
    this.controlLocked = false;  // set during cutscenes / upgrades
    this.engineLoad = 0;         // 0..1 audio/visual cue
    this.wheelSpin = 0;          // animation phase
    this.hydraulicPhase = 0;
    this.impactCooldown = 0;
    this.odometer = 0;
    this.stats = { lifts: 0, placed: 0, damageEvents: 0, distance: 0, idleTime: 0, maxImpact: 0 };
    this.debug = false;
  }

  /* ------------------------------------------------------------- geometry */
  /** Hull circles used for collision (local X offsets from centre). */
  get hull() {
    const l = this.spec.length;
    return [
      { dx: l * 0.32, r: this.spec.width * 0.46 },
      { dx: -l * 0.30, r: this.spec.width * 0.44 }
    ];
  }
  get footprint() { return { w: this.spec.width, l: this.spec.length }; }

  localToWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c };
  }

  /* -------------------------------------------------------------- update */
  update(dt, controls) {
    if (this.impactCooldown > 0) this.impactCooldown -= dt;
    if (this.horn > 0) this.horn -= dt;

    const s = this.spec;
    const throttle = this.controlLocked ? 0 : clamp(controls.throttle ?? 0, -1, 1);
    const steerInput = this.controlLocked ? 0 : clamp(controls.steer ?? 0, -1, 1);
    this.brakeOn = !!controls.brake;

    // ---- longitudinal -------------------------------------------------
    const maxFwd = s.maxSpeed;
    const maxRev = s.maxReverse ?? s.maxSpeed * 0.6;
    const target = throttle >= 0 ? throttle * maxFwd : throttle * maxRev;
    const carrying = this.load ? 1 + (this.load.weight / Math.max(1, s.capacity)) * 0.55 : 1;

    if (this.brakeOn) {
      this.speed = approach(this.speed, 0, s.brakeForce * dt);
    } else if (Math.abs(throttle) > 0.02) {
      const accel = (s.accel * (1 - 0.35 * (Math.abs(this.speed) / maxFwd))) / carrying;
      this.speed += Math.sign(target) * accel * dt * (Math.abs(target) > Math.abs(this.speed) ? 1 : 1.6);
      if (Math.sign(this.speed) !== Math.sign(target) && Math.abs(this.speed) > 0.05) {
        this.speed = approach(this.speed, 0, s.brakeForce * 0.7 * dt);   // direction change through zero
      }
      this.speed = clamp(this.speed, -maxRev, maxFwd);
    } else {
      const drag = 1.1 + Math.abs(this.speed) * 0.5;
      this.speed = approach(this.speed, 0, drag * dt);
      this.stats.idleTime += dt;
    }
    this.engineLoad = damp(this.engineLoad, clamp(Math.abs(throttle) * .8 + (this.load ? .25 : 0), 0, 1), 4, dt);

    // ---- steering -----------------------------------------------------
    const speedFactor = clamp(Math.abs(this.speed) / (maxFwd * 0.45), 0.25, 1.35);
    const steerTarget = steerInput * (s.steerMax ?? 0.6);
    this.steer = damp(this.steer, steerTarget, 7, dt);
    const wheelbase = s.wheelbase ?? s.length * 0.5;
    this.yawRate = (this.speed / wheelbase) * Math.tan(this.steer) * (1 / (1 + 0.10 * Math.abs(this.speed)));
    if (Math.abs(this.speed) > 0.05) this.angle = wrapAngle(this.angle + this.yawRate * dt * (1 / speedFactor) * speedFactor);

    // ---- integrate ----------------------------------------------------
    const oldX = this.x, oldY = this.y;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.wheelSpin += this.speed * dt * (this.spec.wheelSpinRate ?? 2.4);
    this.odometer += dist(oldX, oldY, this.x, this.y);
    this.stats.distance += dist(oldX, oldY, this.x, this.y);

    this._resolveCollisions(dt);
    this.updateAxes(dt, controls);
    this.updateLoad(dt);
  }

  /** Machine-specific axes (forks, boom, trolley, hoist). Overridden. */
  updateAxes(_dt, _controls) { }

  /** Keep a carried load attached. Overridden when the grip is not the centre. */
  updateLoad(dt) {
    if (!this.load) return;
    const grip = this.gripPoint();
    const c = this.load;
    c.x = grip.x; c.y = grip.y; c.angle = grip.angle;
    if (c.handle != null && this.terminal) {
      this.terminal.collision.update(c.handle, {
        x: c.x - c.length / 2, y: c.y - c.width / 2, w: c.length, h: c.width
      });
    }
  }

  /** World point (and angle) where a carried load sits. */
  gripPoint() {
    const p = this.localToWorld(this.spec.length * 0.52, 0);
    return { x: p.x, y: p.y, angle: this.angle };
  }

  /** World point used to search for cargo to pick up. */
  pickupPoint() {
    return this.gripPoint();
  }

  _resolveCollisions(dt) {
    const term = this.terminal;
    if (!term) return;
    let pushedX = 0, pushedY = 0;
    let worst = null;
    for (const h of this.hull) {
      const p = this.localToWorld(h.dx, 0);
      const res = term.collision.resolveCircle(p.x, p.y, h.r);
      if (res.hit) {
        pushedX += res.x; pushedY += res.y;
        if (!worst || res.depth > worst.depth) worst = res;
      }
    }
    if (pushedX || pushedY) {
      this.x += pushedX; this.y += pushedY;
      const impactSpeed = Math.abs(this.speed);
      const nx = worst.nx, ny = worst.ny;
      const into = -(this.vx * nx + this.vy * ny);
      const severity = Math.max(0, into);
      if (severity > 0.55 && this.impactCooldown <= 0) {
        this.impactCooldown = 0.4;
        this.stats.damageEvents++;
        this.stats.maxImpact = Math.max(this.stats.maxImpact, severity);
        const dmg = clamp((severity - 0.55) * 4.2, 0, 14);
        this.condition = clamp(this.condition - dmg, 0, 100);
        this.emitter?.emit('machine:impact', {
          vehicle: this, severity, damage: dmg, condition: this.condition,
          box: worst.box, x: this.x, y: this.y
        });
      }
      // kill the velocity component pushing into the obstacle
      const dot = this.vx * nx + this.vy * ny;
      if (dot < 0) {
        this.vx -= dot * nx; this.vy -= dot * ny;
        this.speed = Math.sign(this.speed) * Math.min(Math.abs(this.speed) * 0.35, 0.4);
      }
    }
  }

  /* ------------------------------------------------------------ actions */
  hornBlast() { this.horn = 0.6; this.emitter?.emit('machine:horn', { vehicle: this }); }

  /** Can this machine lift the given cargo? Delegates to the attachment. */
  canLift(cargo) { return this.attachmentCheck(cargo).ok; }
  attachmentCheck(_cargo) { return { ok: false, code: 'none', message: 'This machine has no lifting attachment.' }; }

  /** Machine-specific action buttons for the HUD / touch overlay. */
  get actions() { return []; }

  /** Runtime state used by the renderer for articulated parts. */
  drawState() { return {}; }

  health() { return this.condition / 100; }
  get isMoving() { return Math.abs(this.speed) > 0.25; }
  get speedKmh() { return Math.abs(this.speed) * 3.6; }
}

export default Vehicle;
