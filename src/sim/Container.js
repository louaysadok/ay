/**
 * Container.js — cargo model.
 *
 * Every cargo unit carries an ID, type, weight, dimensions, handling status,
 * location and destination. The "educational" figures below are intentionally
 * simplified game-simulation values (clearly labelled as such in the UI) —
 * they are not certified operating data.
 */
import { uuid, pick, clamp } from '../engine/Utils.js';

/** ISO container nominal masses used by the simulation (tonnes). */
export const CONTAINER_TARE = { 20: 2.2, 40: 3.8, 45: 4.6 };
export const MAX_GROSS = { 20: 30.48, 40: 32.5, 45: 32.5 };
export const DIMS = {
  20: { length: 6.06, width: 2.44, height: 2.59, label: "20' Standard" },
  40: { length: 12.19, width: 2.44, height: 2.59, label: "40' Standard" },
  45: { length: 13.72, width: 2.44, height: 2.89, label: "45' High Cube" }
};

export const CARGO_KIND = {
  container: { id: 'container', name: 'Container', icon: 'cube', handling: 'spreader', needsSpreadLock: true },
  pallet: { id: 'pallet', name: 'Pallet', icon: 'pallet', handling: 'forks', needsForks: true },
  crate: { id: 'crate', name: 'Crate', icon: 'crate', handling: 'forks', needsForks: true },
  drum: { id: 'drum', name: 'Drum set', icon: 'drum', handling: 'forks', needsForks: true }
};

export const HAZARD = { none: 'none', imdg: 'IMDG 3', reefer: 'Reefer', oog: 'Out of gauge' };

/** Trailer / vessel slots a unit can occupy. */
export function makeContainer(opts = {}) {
  const size = opts.size || pick([20, 40]);
  const t = CONTAINER_TARE[size];
  const net = opts.net ?? (size === 40 ? 12 + Math.random() * 14 : 6 + Math.random() * 12);
  const gross = +(t + net).toFixed(2);
  return {
    id: opts.id || `POAU ${(100000 + Math.floor(Math.random() * 899999))} ${Math.floor(Math.random() * 10)}`,
    uid: uuid('c'),
    kind: 'container',
    size,
    label: DIMS[size].label,
    tare: t,
    net: +net.toFixed(2),
    weight: gross,
    gross,
    length: DIMS[size].length,
    width: DIMS[size].width,
    height: DIMS[size].height,
    liver: opts.liver ?? Math.floor(Math.random() * 10),
    condition: opts.condition ?? (Math.random() < .18 ? 1 : Math.random() < .05 ? 2 : 0),
    hazard: opts.hazard || (Math.random() < .08 ? HAZARD.imdg : 'none'),
    reefer: opts.reefer ?? (Math.random() < .12),
    empty: opts.empty ?? (Math.random() < .22),
    imo: opts.imo || null,
    status: 'idle',              // idle | held | onTruck | onVessel | inSlot | lifting | damaged
    slot: opts.slot || null,     // { blockId, bay, row, tier }
    dest: opts.dest || null,     // location id
    from: opts.from || null,
    x: opts.x ?? 0, y: opts.y ?? 0, angle: opts.angle ?? 0,
    hold: null,                  // handle of the machine currently holding it
    handledBy: null,
    damaged: false,
    ops: 0                       // number of handling operations (efficiency data)
  };
}

export function makePallet(opts = {}) {
  const variant = opts.variant ?? Math.floor(Math.random() * 4);
  const kinds = ['cartons', 'bags', 'drums', 'tiles'];
  const weights = [0.85, 0.62, 1.35, 0.95];
  return {
    id: opts.id || `PALLET-${Math.floor(Math.random() * 9000 + 1000)}`,
    uid: uuid('p'),
    kind: 'pallet',
    size: 1.2,
    label: `Pallet — ${kinds[variant]}`,
    variant,
    weight: +(weights[variant] * (0.9 + Math.random() * 0.3)).toFixed(2),
    length: 1.2, width: 1.2, height: 1.0,
    condition: 0,
    hazard: 'none',
    reefer: false,
    empty: false,
    status: 'idle',
    slot: null, dest: null, from: null,
    x: opts.x ?? 0, y: opts.y ?? 0, angle: opts.angle ?? 0,
    hold: null, handledBy: null, damaged: false, ops: 0
  };
}

export function makeTruck(spot) {
  const truck = {
    id: spot.id,
    kind: spot.kind,
    x: spot.x, y: spot.y, angle: spot.angle || 0,
    trailer: spot.load !== 'empty',
    load: null,
    reversed: spot.kind === 'inbound',
    arrived: true
  };
  if (spot.load === 'pallet') truck.load = makePallet({ x: spot.x - 6, y: spot.y, variant: 1 });
  else if (spot.load === 'container') truck.load = makeContainer({ size: 20, x: spot.x - 8, y: spot.y, status: 'onTruck', weight: 14.6 });
  return truck;
}

/** Yard slot key helper: "yard-n1:2:1:1" (block:bay:row:tier). */
export const slotKey = (blockId, bay, row, tier) => `${blockId}:${bay}:${row}:${tier}`;
export function parseSlotKey(key) {
  const [blockId, bay, row, tier] = key.split(':');
  return { blockId, bay: +bay, row: +row, tier: +tier };
}

/**
 * Validation of a lift: returns { ok, code, message }.
 * `machine` exposes .capacity, .attachment ('forks'|'spreader'|'hook'), .type
 */
export function validateLift(cargo, machine, ctx = {}) {
  if (!cargo) return { ok: false, code: 'no-cargo', message: 'No cargo in position.' };
  if (cargo.hold) return { ok: false, code: 'held', message: 'This cargo unit is already being handled.' };

  const needs = CARGO_KIND[cargo.kind]?.handling;
  const has = machine.attachment;
  if (cargo.kind === 'container') {
    if (has !== 'spreader' && has !== 'hook') {
      return { ok: false, code: 'attachment', message: 'Containers need a spreader or hook — this machine carries forks.' };
    }
    if (has === 'spreader' && machine.spreaderFor && !machine.spreaderFor.includes(cargo.size)) {
      return { ok: false, code: 'spreader-size', message: `Spreader is set for ${machine.spreaderFor.join('/')} ft containers. Re-set it for this ${cargo.size} ft unit.` };
    }
  } else if (needs === 'forks' && has !== 'forks') {
    return { ok: false, code: 'attachment', message: 'This load needs fork tines. Use a machine fitted with forks.' };
  }

  const cap = machine.capacity || 0;
  if (cargo.weight > cap) {
    return {
      ok: false, code: 'capacity',
      message: `Load ${cargo.weight.toFixed(1)} t exceeds this machine's permitted ${cap.toFixed(1)} t capacity.`
    };
  }
  if (ctx.stackedOnTop && ctx.cargoAbove) {
    return { ok: false, code: 'blocked', message: 'Another container is stacked on top — lift that one first.' };
  }
  if (machine.type === 'forklift' && cargo.kind === 'container' && cargo.size >= 40) {
    return { ok: false, code: 'unsafe', message: 'A 40 ft container is beyond safe fork handling — use a reach stacker.' };
  }
  if (ctx.destFull) return { ok: false, code: 'dest', message: 'Destination is occupied.' };
  return { ok: true };
}

export function validatePlace(cargo, dest, terminal) {
  if (!dest) return { ok: false, code: 'no-dest', message: 'No destination selected.' };
  if (dest.kind === 'slot') {
    const slot = terminal.slotAt(dest.blockId, dest.bay, dest.row, dest.tier);
    if (!slot) return { ok: false, code: 'unknown', message: 'Destination is not a valid storage position.' };
    if (slot.tier > 0 && !slot.container) return { ok: false, code: 'gap', message: 'Containers must be stacked bottom-up — lower tiers first.' };
    if (slot.container) return { ok: false, code: 'occupied', message: 'Destination is occupied.' };
    if (cargo.size === 40 && slot.rowSpan) { /* handled by block definition */ }
    return { ok: true };
  }
  if (dest.kind === 'door') return { ok: true };
  if (dest.kind === 'pad') return { ok: true };
  return { ok: true };
}

export default { makeContainer, makePallet, makeTruck, validateLift, validatePlace, DIMS, MAX_GROSS };
