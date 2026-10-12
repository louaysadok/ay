/**
 * Attachments.js — picks, carries and releases cargo for any machine.
 *
 * The rules are intentionally forgiving where the player cannot judge depth
 * (top-down view) and strict where safety or capacity matters:
 *   • the load must be inside the attachment's working radius and aligned
 *   • the machine's rated capacity must exceed the load
 *   • the attachment type must match the cargo (forks ↔ pallet, spreader ↔ box)
 *   • storage positions snap when the machine is close enough (a teaching aid)
 */
import { dist, clamp, angleDiff } from '../engine/Utils.js';
import { validateLift, CARGO_KIND } from './Container.js';

export const PICK_TOLERANCE = {
  forklift: { reach: 2.9, lateral: 1.15, angle: 0.55, lift: 0.42, label: 'forks' },
  reachstacker: { reach: 5.6, lateral: 1.5, angle: 0.34, lift: 1.25, label: 'spreader' },
  rtg: { reach: 8.6, lateral: 1.6, angle: 0.22, lift: 1.1, label: 'spreader' },
  harborcrane: { reach: 7.4, lateral: 2.0, angle: 0.36, lift: 1.6, label: 'hook' },
  tractor: { reach: 3.2, lateral: 1.4, angle: 0.4, lift: 99, label: 'trailer' }
};

export class AttachmentSystem {
  constructor(terminal, bus) {
    this.terminal = terminal;
    this.bus = bus;
    this.lastMessage = '';
  }

  tolerance(v) {
    const t = PICK_TOLERANCE[v.type] || PICK_TOLERANCE.forklift;
    return { ...t, reach: t.reach * (v.reachScale ?? 1) };
  }

  /** Free cargo near the machine's attachment point, best-aligned first. */
  candidates(v) {
    const t = this.tolerance(v);
    const p = v.pickupPoint();
    const list = this.terminal.containersNear(p.x, p.y, t.reach + (v.gripRadiusOffset ?? 0));
    const scored = [];
    for (const c of list) {
      const d = dist(p.x, p.y, c.x, c.y);
      const ang = Math.abs(angleDiff(v.angle, Math.atan2(c.y - p.y, c.x - p.x)));
      const lateral = Math.abs(this._lateralOffset(v, c));
      const ok = d <= t.reach + (c.kind === 'container' ? 1.2 : 0.4)
        && ang <= t.angle + 0.5
        && lateral <= t.lateral;
      scored.push({ cargo: c, d, ang: ang + Math.abs(angleDiff(v.angle, c.angle)) * 0.5, lateral, aligned: ok });
    }
    scored.sort((a, b) => (Number(b.aligned) - Number(a.aligned)) || (a.d - b.d));
    return scored;
  }

  _lateralOffset(v, c) {
    const p = v.pickupPoint();
    const dx = c.x - p.x, dy = c.y - p.y;
    const s = Math.sin(-v.angle), co = Math.cos(-v.angle);
    return dx * -s + dy * co * 1;      // local Y offset (across the machine)
  }

  /** Diagnostic used by the HUD prompt: what would happen if E was pressed. */
  evaluatePick(v) {
    const cands = this.candidates(v);
    if (!cands.length) return { ok: false, code: 'none', message: 'No cargo in reach of the attachment.' };
    const best = cands[0];
    const cargo = best.cargo;
    const t = this.tolerance(v);
    const cab = v.cabStatus ? v.cabStatus(cargo) : { ok: true };

    if (!best.aligned) {
      return {
        ok: false, code: 'align', cargo,
        message: v.type === 'forklift'
          ? 'Line the fork tines up with the pallet openings, then lower the forks.'
          : 'Line the spreader up over the container corners before lowering it.'
      };
    }
    if (!cab.ok) return { ok: false, code: 'position', cargo, message: cab.message };
    const lift = validateLift(cargo, v, { });
    if (!lift.ok) return { ok: false, code: lift.code, cargo, cargo_message: lift.message, message: lift.message };
    return { ok: true, code: 'pick', cargo, message: `Ready to lift ${cargo.id}` };
  }

  /** Diagnostic: what happens if E is pressed while carrying a load. */
  evaluatePlace(v) {
    const cargo = v.load;
    if (!cargo) return { ok: false, code: 'empty', message: 'Nothing is attached.' };
    const p = v.gripPoint();
    const rest = v.releasePoint ? v.releasePoint() : p;
    // a yard trailer deck takes priority — that is what trailers are for
    const trailer = this.terminal.trailerAt?.(rest.x, rest.y, 0.6);
    if (trailer && !trailer.cargo && cargo.kind === 'container') {
      return { ok: true, code: 'trailer', trailer, message: `Set the load onto ${trailer.id.replace('-', ' ')}` };
    }
    if (trailer && trailer.cargo && trailer.cargo !== cargo) {
      return { ok: false, code: 'occupied', message: 'That trailer already carries a container.' };
    }
    const slot = this.terminal.nearestFreeSlot(rest.x, rest.y, cargo.size, { blockKind: v.preferredBlock });
    if (slot && dist(rest.x, rest.y, slot.x, slot.y) <= (v.type === 'forklift' ? 2.0 : 3.6)) {
      return { ok: true, code: 'slot', slot, message: `Release into ${slot.blockId.toUpperCase()} position` };
    }
    if (this._spaceClear(v, cargo, rest)) {
      return { ok: true, code: 'ground', message: 'Set down on the apron' };
    }
    return { ok: false, code: 'blocked', message: 'No clear space to set the load down here.' };
  }

  _spaceClear(v, cargo, at) {
    const half = Math.max(cargo.length, cargo.width) / 2 + 0.9;
    const hits = this.terminal.collision.queryRect(
      { x: at.x - half, y: at.y - half, w: half * 2, h: half * 2 },
      [], (b) => b.kind !== 'lane' && b.kind !== 'zone' && b.kind !== 'marking' && b.id !== cargo.id
    );
    for (const b of hits) {
      if (b.cargo === cargo) continue;
      if (b.kind === 'cargo') {
        if (dist(b.x + b.w / 2, b.y + b.h / 2, at.x, at.y) > (cargo.length + Math.max(b.w, b.h)) * 0.52) continue;
        return false;
      }
      if (b.kind === 'building' || b.kind === 'fence' || b.kind === 'prop' || b.kind === 'vehicle') return false;
    }
    return true;
  }

  /** Perform the lift. Returns { ok, cargo, message }. */
  pick(v) {
    const evalRes = this.evaluatePick(v);
    if (!evalRes.ok) {
      this.bus?.emit('cargo:rejected', { vehicle: v, code: evalRes.code, message: evalRes.message, cargo: evalRes.cargo });
      return evalRes;
    }
    const cargo = evalRes.cargo;
    const grip = v.gripPoint();
    // detach from previous owner
    if (cargo.slot) this.terminal.removeFromSlot(cargo);
    if (cargo.truck) {
      const truck = this.terminal.trucks.find((t) => t.id === cargo.truck);
      if (truck) { truck.load = null; truck.trailer = false; }
      cargo.truck = null;
    }
    if (cargo.vessel) {
      const ship = this.terminal.ships.find((s) => s.id === cargo.vessel);
      if (ship) ship.containers = ship.containers.filter((c) => c !== cargo);
      cargo.vessel = null;
    }
    if (cargo.trailer) {
      const trailer = this.terminal.trailers?.find((t) => t.id === cargo.trailer);
      if (trailer) trailer.cargo = null;
      cargo.trailer = null;
    }
    if (cargo.handle != null) { this.terminal.collision.remove(cargo.handle); cargo.handle = null; }
    cargo.status = 'held';
    cargo.heldAt = performance.now();
    cargo.x = grip.x; cargo.y = grip.y; cargo.angle = grip.angle;
    cargo.hold = v.id;
    cargo.handledBy = v.type;
    cargo.ops++;
    cargo.handle = this.terminal.collision.add(
      { x: cargo.x - cargo.length / 2, y: cargo.y - cargo.width / 2, w: cargo.length, h: cargo.width },
      { kind: 'held-cargo', id: cargo.id, cargo, solid: false }
    );
    v.load = cargo;
    v.stats.lifts++;
    this.bus?.emit('cargo:lifted', { vehicle: v, cargo });
    return { ok: true, cargo, message: `Lifted ${cargo.id}` };
  }

  /** Release the carried load at the current attachment position. */
  place(v, opts = {}) {
    const cargo = v.load;
    if (!cargo) return { ok: false, code: 'empty', message: 'Nothing to set down.' };
    const evalRes = this.evaluatePlace(v);
    if (!evalRes.ok) {
      this.bus?.emit('cargo:rejected', { vehicle: v, code: evalRes.code, message: evalRes.message, cargo });
      return evalRes;
    }
    const rest = v.releasePoint ? v.releasePoint() : v.gripPoint();

    if (cargo.handle != null) { this.terminal.collision.remove(cargo.handle); cargo.handle = null; }
    v.load = null;
    cargo.hold = null;

    if (evalRes.code === 'slot') {
      this.terminal.placeInSlot(cargo, evalRes.slot);
    } else if (evalRes.code === 'trailer') {
      const trailer = evalRes.trailer;
      trailer.cargo = cargo;
      cargo.trailer = trailer.id;
      cargo.status = 'idle';
      cargo.x = trailer.x; cargo.y = trailer.y; cargo.angle = trailer.angle;
      cargo.handle = this.terminal.collision.add(
        { x: cargo.x - cargo.length / 2, y: cargo.y - cargo.width / 2, w: cargo.length, h: cargo.width },
        { kind: 'cargo', id: cargo.id, cargo, solid: true }
      );
    } else {
      cargo.status = 'idle';
      cargo.x = rest.x; cargo.y = rest.y; cargo.angle = v.angle;
      cargo.handle = this.terminal.collision.add(
        { x: cargo.x - cargo.length / 2, y: cargo.y - cargo.width / 2, w: cargo.length, h: cargo.width },
        { kind: 'cargo', id: cargo.id, cargo, solid: true }
      );
    }
    v.stats.placed++;
    this.bus?.emit('cargo:placed', { vehicle: v, cargo, mode: evalRes.code, slot: evalRes.slot, x: cargo.x, y: cargo.y });
    return { ok: true, cargo, message: `Set down ${cargo.id}` };
  }

  /** Toggle: try to place a carried load, otherwise try to pick one up. */
  toggle(v) {
    if (v.load) return this.place(v);
    return this.pick(v);
  }
}

export default AttachmentSystem;
