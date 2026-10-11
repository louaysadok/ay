/**
 * Terminal.js — the port world model.
 *
 * Owns the static layout (areas, roads, buildings, yard blocks), the dynamic
 * contents (containers in slots, trucks, ships, pedestrians, traffic), and the
 * collision world every machine queries.
 *
 * Coordinate system: world metres, +X east, +Y south, angles in radians
 * (0 = facing east/+X). Water is north of `waterLine`.
 */
import { makeRng, dist, clamp, rand, TAU, uuid } from '../engine/Utils.js';
import { CollisionWorld } from '../engine/Collision.js';
import { makeContainer, makePallet, makeTruck, slotKey, DIMS } from './Container.js';

export class Terminal {
  constructor(layout, bus) {
    this.layout = layout;
    this.bus = bus;
    this.rng = makeRng(20260511);
    this.collision = new CollisionWorld(16);
    this.containers = [];
    this.pallets = [];
    this.trucks = [];
    this.ships = [];
    this.slots = new Map();          // key -> { blockId, bay, row, tier, container, handle }
    this.blocks = new Map();
    this.zones = [];                 // named rects for missions
    this.props = {};                 // machine handles etc
    this.machineHandles = [];
    this.pedestrians = [];
    this.trailers = [];              // yard trailers the terminal tractor can couple to
    this.traffic = [];
    this.time = 0;
    this.stats = { containersMoved: 0, lifts: 0, damage: 0 };
    this._build();
  }

  /* ===================================================================== */
  /*  construction                                                         */
  /* ===================================================================== */

  _build() {
    const L = this.layout;
    this.bounds = { x: 0, y: 0, w: L.world.w, h: L.world.h };
    this.waterLine = L.world.waterLine;

    // ---- static solids -------------------------------------------------
    for (const b of L.buildings) {
      this.collision.add(b.rect, { kind: 'building', id: b.id, name: b.name, solid: true, blocksSight: true });
      for (const d of b.doors || []) {
        this.collision.add({ x: d.x, y: d.y, w: d.w, h: d.h }, { kind: 'door', id: d.id, building: b.id });
      }
    }
    for (const f of L.fences) this.collision.add(f, { kind: 'fence', solid: true });
    for (const [lx, ly] of L.lampPosts) this.collision.add({ x: lx - .35, y: ly - .35, w: .7, h: .7 }, { kind: 'prop', id: 'lamp', solid: true });
    this.collision.add(L.fuelIsland, { kind: 'prop', id: 'fuel-island', name: 'Fuel island', solid: true });
    const park = L.parking;
    this.collision.add(park, { kind: 'zone', id: 'parking', name: 'Parking' });
    for (const pad of L.trainingPads) {
      this.collision.add(pad, { kind: 'zone', id: pad.id, name: `Training pad ${pad.label}`, trainingPad: true });
    }
    for (const rz of L.restrictedZones || []) {
      this.collision.add(rz.rect, { kind: 'restricted', id: rz.id, name: rz.name, level: rz.level, reason: rz.reason });
    }
    for (const w of L.walkways || []) this.collision.add(w, { kind: 'walkway', id: uuid('walk') });
    // road surfaces are non-solid annotations used for traffic & AI
    for (const r of L.roads) this.collision.add(r.rect, { kind: 'lane', id: r.id, main: r.main });

    // ---- yard blocks & slots -------------------------------------------
    for (const blk of L.yardBlocks) {
      this.blocks.set(blk.id, blk);
      const rowW = 2.7;
      const slots = [];
      for (let bay = 0; bay < blk.cols; bay++) {
        for (let row = 0; row < blk.rows; row++) {
          for (let tier = 0; tier < blk.maxTier; tier++) {
            const x = blk.x + bay * (blk.slotW + blk.gap) + blk.slotW / 2;
            const y = blk.y + row * rowW + rowW / 2;
            const key = slotKey(blk.id, bay, row, tier);
            const slot = { key, blockId: blk.id, bay, row, tier, x, y, angle: 0, container: null, handle: null, kind: 'slot' };
            this.slots.set(key, slot);
            slots.push(slot);
          }
        }
      }
      blk.slots = slots;
      blk.rect = {
        x: blk.x - 2,
        y: blk.y - 1.6,
        w: blk.cols * (blk.slotW + blk.gap) - blk.gap + 4,
        h: blk.rows * rowW + 3.2
      };
      // gantry travel lane markers both sides of the block
      this.collision.add(blk.rect, { kind: 'zone', id: blk.id, name: blk.name, blockId: blk.id });
    }

    // ---- zones used by missions ----------------------------------------
    this.zones = [
      ...L.areas.map((a) => ({ id: a.id, name: a.name, rect: a.rect, kind: 'area', icon: a.icon })),
      ...L.buildings.flatMap((b) => (b.doors || []).map((d) => ({ id: d.id, name: `${b.name} dock`, rect: { x: d.x - 3, y: d.y - 5, w: 6 + d.w, h: d.h + 10 }, kind: 'door' }))),
      ...L.trainingPads.map((p) => ({ id: p.id, name: `Training pad ${p.label}`, rect: p, kind: 'pad' })),
      ...L.truckSpots.map((s) => ({ id: s.id, name: s.kind === 'inbound' ? 'Inbound lane' : 'Outbound lane', rect: { x: s.x - 22, y: s.y - 6, w: 34, h: 12 }, kind: 'truck' })),
      ...L.berths.map((b) => ({ id: b.id, name: b.name, rect: { x: b.x - b.length / 2, y: 30, w: b.length, h: 26 }, kind: 'berth' }))
    ];

    // ---- ships ----------------------------------------------------------
    for (const s of this.layout.ships) this.ships.push(this._makeShip(s));

    // ---- trucks in the gate lanes --------------------------------------
    for (const spot of L.truckSpots) {
      const truck = makeTruck(spot);
      truck.spot = spot;
      this.trucks.push(truck);
      this.collision.add({ x: truck.x - 12, y: truck.y - 1.6, w: 24, h: 3.2 }, { kind: 'vehicle', id: truck.id, name: 'Truck', truck });
      if (truck.load) this._attachTruckLoad(truck);
    }

    // ---- yard trailers (terminal tractor work) ---------------------------
    for (const d of (L.trailers || [])) {
      const trailer = {
        id: d.id, kind: d.kind || 'yard',
        x: d.x, y: d.y, angle: d.angle ?? 0,
        length: 12.2, width: 2.5,
        cargo: null, towedBy: null, handle: null
      };
      trailer.handle = this.collision.add(
        { x: trailer.x - trailer.length / 2, y: trailer.y - trailer.width / 2, w: trailer.length, h: trailer.width },
        { kind: 'trailer', id: trailer.id, name: 'Yard trailer', trailer, solid: true }
      );
      this.trailers.push(trailer);
    }

    // ---- warehouse pallets ---------------------------------------------
    for (const p of L.warehousePallets) {
      const pallet = makePallet({ id: p.id, x: p.x, y: p.y, variant: p.variant });
      this.pallets.push(pallet);
      pallet.handle = this.collision.add({ x: p.x - .7, y: p.y - .7, w: 1.4, h: 1.4 }, { kind: 'cargo', id: pallet.id, cargo: pallet, solid: true });
    }

    // ---- seed the yard with an initial stock of containers ---------------
    this._seedYard(0.46);

    // ---- pedestrians (safety NPCs) -------------------------------------
    this.pedestrians = (L.pedestrians || []).map((p) => ({
      id: p.id, name: p.name, path: p.path, t: Math.random(), speed: rand(.9, 1.35),
      x: p.path[0][0], y: p.path[0][1], dir: 1, angle: 0, handle: null, alive: true, nearMissTimer: 0
    }));

    // ---- ambient terminal traffic --------------------------------------
    this.traffic = [];
    for (let i = 0; i < 3; i++) this.traffic.push(this._spawnTrafficTruck(i));
  }

  /**
   * Fill part of the yard so the terminal looks alive from the first frame.
   * Stacks are built bottom-up with realistic random tiers 1..maxTier.
   */
  _seedYard(fill = 0.45) {
    const rng = makeRng(4242);
    for (const blk of this.layout.yardBlocks) {
      for (let bay = 0; bay < blk.cols; bay++) {
        for (let row = 0; row < blk.rows; row++) {
          if (rng() > fill) continue;
          const tiers = rng.int(1, Math.max(2, blk.maxTier - 1));
          let size = rng.bool(0.72) ? 40 : 20;
          for (let t = 0; t < tiers; t++) {
            const slot = this.slotAt(blk.id, bay, row, t);
            if (!slot) break;
            const c = makeContainer({
              size: t === 0 ? size : (rng.bool(0.9) ? size : 20),
              liver: rng.int(0, 9),
              condition: rng.bool(0.22) ? 1 : 0,
              empty: rng.bool(0.28)
            });
            c.tare = c.tare;
            this.containers.push(c);
            this.placeInSlot(c, slot);
          }
        }
      }
    }
  }

  _makeShip(def) {
    const rng = makeRng(def.id.length * 977 + 13);
    const ship = {
      ...def,
      containers: [],
      tierCount: new Array(def.containers.bays).fill(0),
      name: def.name,
      status: def.containers.fill < .55 ? 'loading' : 'discharging'
    };
    const bays = def.containers.bays, rows = def.containers.rows, maxTier = def.containers.maxTier;
    const bayLen = def.length / bays;
    for (let b = 0; b < bays; b++) {
      for (let r = 0; r < rows; r++) {
        const stackTiers = rng() < def.containers.fill ? rng.int(1, maxTier) : 0;
        for (let t = 0; t < stackTiers; t++) {
          const size = rng.bool(.75) ? 40 : 20;
          const x = def.x - def.length / 2 + bayLen * b + bayLen / 2;
          const y = def.y - def.beam / 2 + 2.1 + r * 2.7;
          const c = makeContainer({ size, x, y, liver: rng.int(0, 9), condition: rng.bool(.2) ? 1 : 0, empty: rng.bool(.2) });
          c.status = 'onVessel';
          c.vessel = def.id;
          c.deck = { bay: b, row: r, tier: t, x, y };
          ship.containers.push(c);
          this.containers.push(c);
        }
      }
    }
    ship.deckY0 = def.y - def.beam / 2 + 2.1;
    ship.bayLen = bayLen;
    return ship;
  }

  _attachTruckLoad(truck) {
    const c = truck.load;
    c.status = 'onTruck';
    c.truck = truck.id;
    if (c.kind === 'container') {
      c.x = truck.x - 9;
      c.y = truck.y;
      c.angle = truck.angle;
      c.handle = this.collision.add(
        { x: c.x - c.length / 2, y: c.y - c.width / 2, w: c.length, h: c.width },
        { kind: 'cargo', id: c.id, cargo: c, solid: true, onTruck: true }
      );
      this.containers.push(c);
    } else {
      c.x = truck.x - 7;
      c.y = truck.y;
      c.handle = this.collision.add({ x: c.x - .7, y: c.y - .7, w: 1.4, h: 1.4 }, { kind: 'cargo', id: c.id, cargo: c, solid: true });
      this.pallets.push(c);
    }
  }

  _spawnTrafficTruck(i) {
    const route = [
      { x: 320, y: 200 }, { x: 13, y: 200 }, { x: 13, y: 74 }, { x: 240, y: 74 }, { x: 259, y: 74 }, { x: 259, y: 150 }, { x: 303, y: 150 }, { x: 303, y: 200 }
    ];
    return {
      id: `traffic-${i}`,
      x: route[i % route.length].x,
      y: route[i % route.length].y,
      angle: 0,
      speed: rand(4.5, 7.5),
      route,
      leg: i % route.length,
      progress: rand(0, .8),
      length: i % 2 ? 12 : 7,
      color: i % 2 ? '#3f7fb7' : '#c8563a',
      stopped: 0
    };
  }

  /* ===================================================================== */
  /*  queries                                                              */
  /* ===================================================================== */

  areaAt(x, y) {
    for (const a of this.layout.areas) {
      const r = a.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return a;
    }
    if (y < this.waterLine) return { id: 'water', name: 'Harbour water', icon: 'water' };
    return null;
  }

  zoneAt(x, y) {
    for (const z of this.zones) {
      const r = z.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return z;
    }
    return null;
  }

  restrictedAt(x, y) {
    return (this.layout.restrictedZones || []).find((z) =>
      x >= z.rect.x && x <= z.rect.x + z.rect.w && y >= z.rect.y && y <= z.rect.y + z.rect.h) || null;
  }

  slotAt(blockId, bay, row, tier) {
    return this.slots.get(slotKey(blockId, +bay, +row, +tier)) || null;
  }

  /** Ground slot (tier 0) position of a stack column. */
  columnAt(blockId, bay, row) {
    return this.slotAt(blockId, bay, row, 0);
  }

  topTier(blockId, bay, row) {
    const blk = this.blocks.get(blockId);
    if (!blk) return -1;
    for (let t = blk.maxTier - 1; t >= 0; t--) {
      const s = this.slotAt(blockId, bay, row, t);
      if (s?.container) return t;
    }
    return -1;
  }

  isSlotFree(blockId, bay, row) {
    return this.topTier(blockId, bay, row) < 0;
  }

  /** Find the container sitting above a given (block,bay,row) column, if any. */
  topContainerAt(blockId, bay, row) {
    const t = this.topTier(blockId, bay, row);
    return t < 0 ? null : this.slotAt(blockId, bay, row, t).container;
  }

  /**
   * Reserve a slot for a container. Returns the slot or null when full.
   * Handles the simple "stack on top of same size" rule.
   */
  reserveSlot(blockId, bay, row, size) {
    const blk = this.blocks.get(blockId);
    if (!blk) return null;
    const top = this.topTier(blockId, bay, row);
    const tier = top + 1;
    if (tier >= blk.maxTier) return null;
    if (top >= 0) {
      const below = this.slotAt(blockId, bay, row, top).container;
      if (below && below.size < size) return null;     // never put a big box on a small one
    }
    const slot = this.slotAt(blockId, bay, row, tier);
    return slot || null;
  }

  placeInSlot(container, slot) {
    const prev = this.slots.get(slot.key);
    if (!prev || prev.container) return false;
    prev.container = container;
    container.status = 'inSlot';
    container.slot = { blockId: slot.blockId, bay: slot.bay, row: slot.row, tier: slot.tier };
    container.x = slot.x;
    container.y = slot.y;
    container.angle = 0;
    container.hold = null;
    if (container.handle == null) {
      container.handle = this.collision.add(
        { x: slot.x - container.length / 2, y: slot.y - container.width / 2, w: container.length, h: container.width },
        { kind: 'cargo', id: container.id, cargo: container, solid: true, stackTier: slot.tier }
      );
    } else {
      this.collision.update(container.handle, { x: slot.x - container.length / 2, y: slot.y - container.width / 2, w: container.length, h: container.width });
    }
    this.bus?.emit('cargo:stowed', { container, slot });
    return true;
  }

  removeFromSlot(container) {
    if (!container.slot) return;
    const slot = this.slotAt(container.slot.blockId, container.slot.bay, container.slot.row, container.slot.tier);
    if (slot) slot.container = null;
    container.slot = null;
    if (container.handle != null) { this.collision.remove(container.handle); container.handle = null; }
  }

  /** Nearest free storage position for a container at world position (x,y). */
  nearestFreeSlot(x, y, size = 40, opts = {}) {
    let best = null, bestD = Infinity;
    const wanted = opts.blockKind || null;
    for (const blk of this.blocks.values()) {
      if (wanted && blk.kind !== wanted) continue;
      for (let bay = 0; bay < blk.cols; bay++) {
        for (let row = 0; row < blk.rows; row++) {
          const top = this.topTier(blk.id, bay, row);
          if (top + 1 >= blk.maxTier) continue;
          if (top >= 0) {
            const below = this.slotAt(blk.id, bay, row, top).container;
            if (below && below.size < size) continue;
          }
          const g = this.slotAt(blk.id, bay, row, 0);
          const d = dist(x, y, g.x, g.y);
          if (d < bestD) { bestD = d; best = this.slotAt(blk.id, bay, row, top + 1); }
        }
      }
    }
    return best;
  }

  /** All containers near a point (used for spreader snapping). */
  containersNear(x, y, radius) {
    const out = [];
    for (const c of this.containers) {
      if (c.status === 'held' || c.status === 'lifting') continue;
      if (dist(x, y, c.x, c.y) <= radius) out.push(c);
    }
    for (const p of this.pallets) {
      if (p.status === 'held') continue;
      if (dist(x, y, p.x, p.y) <= radius) out.push(p);
    }
    return out;
  }

  /** Free pallets lying on the ground / on trucks / on ships. */
  cargoById(id) {
    return this.containers.find((c) => c.id === id)
      || this.pallets.find((p) => p.id === id)
      || null;
  }

  /** Counting helpers for missions. */
  countInArea(zoneId, kind = null) {
    const z = this.zones.find((q) => q.id === zoneId);
    if (!z) return 0;
    const inRect = (o) => o.x >= z.rect.x && o.x <= z.rect.x + z.rect.w && o.y >= z.rect.y && o.y <= z.rect.y + z.rect.h;
    let n = 0;
    for (const c of this.containers) if (c.status !== 'held' && (!kind || c.kind === kind) && inRect(c)) n++;
    for (const p of this.pallets) if (p.status !== 'held' && (!kind || p.kind === kind) && inRect(p)) n++;
    return n;
  }

  /* ===================================================================== */
  /*  update                                                               */
  /* ===================================================================== */

  update(dt, ctx = {}) {
    this.time += dt;
    this._updateTrailers(dt);
    this._updateTraffic(dt);
    this._updatePedestrians(dt);
    for (const s of this.ships) this._updateShip(s, dt);
  }

  /** Trailers follow the tractor that couples to them (rigid tow). */
  _updateTrailers(dt) {
    for (const t of this.trailers) {
      const tractor = t.towedBy ? this.machineHandles.find((m) => m.id === t.towedBy) : null;
      if (!tractor) {
        if (t.towedBy) { t.towedBy = null; }
        continue;
      }
      const p = tractor.trailerPoint ? tractor.trailerPoint() : { x: tractor.x, y: tractor.y };
      // the coupling sits at the front of the trailer, the body trails behind
      const back = t.length * 0.5 + 1.1;
      t.angle = tractor.angle;
      t.x = p.x - Math.cos(tractor.angle) * back;
      t.y = p.y - Math.sin(tractor.angle) * back;
      if (t.handle != null) {
        this.collision.update(t.handle, { x: t.x - t.length / 2, y: t.y - t.width / 2, w: t.length, h: t.width });
      }
      if (t.cargo) {
        t.cargo.x = t.x; t.cargo.y = t.y; t.cargo.angle = t.angle;
        if (t.cargo.handle != null) {
          this.collision.update(t.cargo.handle, {
            x: t.cargo.x - t.cargo.length / 2, y: t.cargo.y - t.cargo.width / 2,
            w: t.cargo.length, h: t.cargo.width
          });
        }
      }
    }
  }

  /** The trailer whose deck covers a world point, if any. */
  trailerAt(x, y, margin = 0) {
    for (const t of this.trailers) {
      const dx = x - t.x, dy = y - t.y;
      const c = Math.cos(-t.angle), sn = Math.sin(-t.angle);
      const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      if (Math.abs(lx) <= t.length / 2 + margin && Math.abs(ly) <= t.width / 2 + margin) return t;
    }
    return null;
  }

  /**
   * Mission helper: is this cargo currently resting at a destination rect
   * (on the ground or sitting on a trailer parked inside the rect)?
   */
  cargoAtRect(cargo, rect) {
    if (!cargo) return false;
    if (cargo.x >= rect.x && cargo.x <= rect.x + rect.w && cargo.y >= rect.y && cargo.y <= rect.y + rect.h) return true;
    return false;
  }

  _updateShip(ship, dt) {
    ship.status = ship.status; // reserved for future loading choreography
  }

  _updateTraffic(dt) {
    for (const t of this.traffic) {
      if (t.stopped > 0) { t.stopped -= dt; continue; }
      const a = t.route[t.leg], b = t.route[(t.leg + 1) % t.route.length];
      const segLen = Math.max(0.001, Math.hypot(b.x - a.x, b.y - a.y));
      const dirx = (b.x - a.x) / segLen, diry = (b.y - a.y) / segLen;
      t.angle = Math.atan2(diry, dirx);
      t.progress += (t.speed * dt) / segLen;
      if (t.progress >= 1) {
        t.progress -= 1;
        t.leg = (t.leg + 1) % t.route.length;
      }
      t.x = a.x + (b.x - a.x) * t.progress;
      t.y = a.y + (b.y - a.y) * t.progress;
      // lane offset so opposing trucks do not overlap
      const lane = 3.2;
      t.drawX = t.x - diry * lane;
      t.drawY = t.y + dirx * lane;
    }
  }

  _updatePedestrians(dt) {
    for (const p of this.pedestrians) {
      const a = p.path[0], b = p.path[1];
      const segLen = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      p.t += (p.dir * p.speed * dt) / segLen;
      if (p.t > 1) { p.t = 1; p.dir = -1; }
      if (p.t < 0) { p.t = 0; p.dir = 1; }
      p.x = a[0] + (b[0] - a[0]) * p.t;
      p.y = a[1] + (b[1] - a[1]) * p.t;
      p.angle = Math.atan2(p.dir * (b[1] - a[1]), p.dir * (b[0] - a[0]));
      if (p.nearMissTimer > 0) p.nearMissTimer -= dt;
    }
  }

  /** Machine-vs-pedestrian proximity check for the safety score. */
  pedestrianNear(x, y, radius) {
    let worst = null, worstD = Infinity;
    for (const p of this.pedestrians) {
      const d = dist(x, y, p.x, p.y);
      if (d < radius && d < worstD) { worstD = d; worst = p; }
    }
    return worst ? { ped: worst, d: worstD } : null;
  }
}

export default Terminal;
