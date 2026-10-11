/**
 * MissionManager.js — runs career jobs, academy lessons and free-op job cards.
 *
 * A job is a list of objectives evaluated every simulation step against the
 * live terminal. Objectives are declarative (see data/missions.json) so new
 * content does not need engine changes.
 *
 * Objective types
 *   reach        drive into a zone / near a point
 *   stop         come to a full stop
 *   move/reverse accumulate distance
 *   horn         sound the horn N times
 *   lift         lift N units matching a cargo kind
 *   liftId       lift a specific container id
 *   liftAny      lift N units of anything
 *   liftFromBlock lift N units out of a named yard block
 *   place        set a load down at a zone / lane
 *   stack        place N units into a named (or any) yard block
 *   deliver      place N units into a named zone
 *   park         finish inside a named pad
 *   axis         compare a machine axis (fork height, boom angle, …)
 *   cycle        cycle the spreader N times
 *   damage       keep cargo damage at or under a value
 *   clean        keep safety events at or under a value
 *   time         finish inside a limit
 */
import { clamp, dist, fmtTime } from '../engine/Utils.js';

export const OBJECTIVE_STATE = { PENDING: 'pending', DONE: 'done', FAILED: 'failed' };

export class MissionManager {
  constructor({ terminal, bus, i18n, settings, attachments, save }) {
    this.terminal = terminal;
    this.bus = bus;
    this.i18n = i18n;
    this.settings = settings;
    this.attachments = attachments;
    this.save = save;
    this.active = null;
    this.mode = 'career';
    this.completedIds = new Set();
    this.log = [];
    this.onComplete = null;
    this.onFail = null;
    this.mentor = null;      // set by Game so lesson steps can drive dialogue
  }

  /* ---------------------------------------------------------------- start */
  start(definition, { mode = 'career', machine = null } = {}) {
    this.stop(true);
    const timeLimit = definition.timeLimit
      ? Math.round(definition.timeLimit * (this.settings?.timeFactor?.() ?? 1))
      : null;

    const objectives = (definition.objectives || definition.goals || []).map((o, i) => ({
      ...o,
      index: i,
      label: o.label || this.describeObjective(o),
      state: OBJECTIVE_STATE.PENDING,
      progress: 0,
      _baseline: null
    }));

    this.active = {
      def: definition,
      id: definition.id,
      mode,
      title: definition.title,
      subtitle: definition.subtitle || '',
      machine: machine || definition.machine,
      objectives,
      timeLimit,
      elapsed: 0,
      remaining: timeLimit,
      started: performance.now(),
      safetyEvents: 0,
      cargoDamage: 0,
      impacts: [],
      liftedIds: new Set(),
      deliveredIds: new Set(),
      placedIds: new Set(),
      hornCount: 0,
      cycles: 0,
      distance: 0,
      reverseDistance: 0,
      stops: 0,
      idleTime: 0,
      spreaderSizeChanges: 0,
      wrongAttachmentAttempts: 0,
      overcapacityAttempts: 0,
      status: 'running',
      lessonStep: 0,
      lastProgressAt: performance.now()
    };
    this._captureBaselines();
    this.bus?.emit('mission:started', { mission: this.active });
    return this.active;
  }

  _captureBaselines() {
    const m = this.active;
    if (!m) return;
    m._base = {
      containersMoved: this.terminal.stats.containersMoved,
      lifts: this.terminal.stats.lifts,
      damage: this.terminal.stats.damage
    };
    for (const o of m.objectives) o._baseline = this._objectiveBaseline(o);
  }

  _objectiveBaseline(o) {
    const T = this.terminal;
    switch (o.type) {
      case 'liftAny': return T.stats.lifts;
      case 'liftFromBlock': return null;
      case 'damage': return T.stats.damage;
      default: return null;
    }
  }

  stop(silent = false) {
    if (this.active && !silent) this.bus?.emit('mission:aborted', { mission: this.active });
    this.active = null;
  }

  /* --------------------------------------------------------------- update */
  update(dt, ctx) {
    const m = this.active;
    if (!m || m.status !== 'running') return;
    const { vehicle, terminal } = ctx;
    m.elapsed += dt;

    // ---- world-level telemetry ------------------------------------------
    if (vehicle) {
      m.distance += Math.abs(vehicle.speed) * dt;
      if (vehicle.speed < -0.1) m.reverseDistance += Math.abs(vehicle.speed) * dt;
      if (Math.abs(vehicle.speed) < 0.05) m.idleTime += dt;
    }
    if (m.timeLimit) {
      m.remaining = Math.max(0, m.timeLimit - m.elapsed);
      if (m.remaining <= 0) { this._fail('time'); return; }
      // final 10 seconds: tick for the audio system
      const s = Math.ceil(m.remaining);
      if (s <= 10 && s !== m._lastTick) { m._lastTick = s; this.bus?.emit('mission:tick', { seconds: s }); }
    }

    // ---- evaluate --------------------------------------------------------
    let allDone = true;
    for (const o of m.objectives) {
      if (o.state === OBJECTIVE_STATE.PENDING) {
        const res = this._evaluate(o, ctx);
        if (res.done) {
          o.state = OBJECTIVE_STATE.DONE;
          o.completedAt = m.elapsed;
          m.lastProgressAt = performance.now();
          this.bus?.emit('mission:objective', { objective: o, mission: m });
        } else if (res.failed) {
          o.state = OBJECTIVE_STATE.FAILED;
          this._fail(res.reason || 'objective', o);
          return;
        }
        allDone = allDone && o.state === OBJECTIVE_STATE.DONE;
      } else if (o.state !== OBJECTIVE_STATE.DONE) {
        allDone = false;
      }
    }
    if (allDone && m.objectives.length) this._complete();

    // ---- lesson step choreography (Academy) ------------------------------
    if (m.mode === 'academy' && this.mentor) this.mentor.updateLesson(m, ctx);
  }

  _evaluate(o, ctx) {
    const m = this.active;
    const { vehicle, terminal } = ctx;
    if (!vehicle || !m) return { done: false };
    switch (o.type) {
      case 'reach': {
        const target = this._resolveTarget(o.target);
        if (!target) return { done: true };
        const R = o.radius ?? Math.max(target.rect.w, target.rect.h) * 0.6;
        const d = this._distanceToRect(vehicle.x, vehicle.y, target.rect);
        o.progress = clamp(1 - d / Math.max(R, 0.1), 0, 1);
        return { done: d <= R };
      }
      case 'park': {
        const target = this._resolveTarget(o.where);
        if (!target) return { done: true };
        const inside = this._pointInRect(vehicle.x, vehicle.y, target.rect);
        o.progress = inside ? 1 : 0.35;
        return { done: inside && Math.abs(vehicle.speed) < 0.4 };
      }
      case 'stop':
        o.progress = Math.abs(vehicle.speed) < (o.speedBelow ?? 0.2) ? 1 : 0;
        return { done: o.progress >= 1 };
      case 'move':
        o.progress = clamp(m.distance / (o.distance ?? 30), 0, 1);
        return { done: m.distance >= (o.distance ?? 30) };
      case 'reverse':
        o.progress = clamp(m.reverseDistance / (o.distance ?? 10), 0, 1);
        return { done: m.reverseDistance >= (o.distance ?? 10) };
      case 'horn':
        o.progress = clamp(m.hornCount / (o.count ?? 1), 0, 1);
        return { done: m.hornCount >= (o.count ?? 1) };
      case 'cycle':
        o.progress = clamp(m.cycles / (o.count ?? 1), 0, 1);
        return { done: m.cycles >= (o.count ?? 1) };
      case 'axis': {
        const v = vehicle[o.axis];
        const ok = this._compare(v, o.op ?? '>', o.value);
        o.progress = ok ? 1 : this._axisProgress(v, o);
        return { done: o.sustained ? m.elapsed > (o.after ?? 0) && ok : ok };
      }
      case 'lift':
      case 'liftAny': {
        o.progress = clamp(m.liftedIds.size / (o.count ?? 1), 0, 1);
        return { done: m.liftedIds.size >= (o.count ?? 1) };
      }
      case 'liftId': {
        const id = m.nominatedId || o.cargoId;
        if (!id) return { done: m.liftedIds.size >= (o.count ?? 1) };
        o.progress = m.liftedIds.has(id) ? 1 : 0;
        return { done: m.liftedIds.has(id) };
      }
      case 'liftFromBlock':
      case 'liftAnyBlock': {
        o.progress = clamp(m.blockLifts.size / (o.count ?? 1), 0, 1);
        return { done: m.blockLifts.size >= (o.count ?? 1) };
      }
      case 'place':
      case 'deliver':
      case 'stack': {
        const need = o.count ?? 1;
        const n = this._placementMatches(o, ctx);
        o.progress = clamp(n / need, 0, 1);
        return { done: n >= need };
      }
      case 'damage': {
        const dmg = terminal.stats.damage - (m._base?.damage ?? 0);
        o.progress = clamp(1 - dmg / Math.max(1, (o.max ?? 0) + 1), 0, 1);
        return { done: false, failed: dmg > (o.max ?? 0) ? true : false, reason: 'damage' };
      }
      case 'clean': {
        o.progress = m.safetyEvents <= (o.events ?? 0) ? 1 : 0;
        return { done: true, failed: m.safetyEvents > (o.events ?? 0) ? true : false, reason: 'safety' };
      }
      case 'time': {
        o.progress = clamp(m.remaining / (o.limit ?? 60), 0, 1);
        return { done: false };
      }
      default:
        return { done: true };
    }
  }

  _compare(v, op, value) {
    switch (op) {
      case '>': return v > value;
      case '>=': return v >= value;
      case '<': return v < value;
      case '<=': return v <= value;
      case '==': return v === value || Math.abs(v - value) < 1e-6;
      case '!=': return v !== value;
      default: return false;
    }
  }
  _axisProgress(v, o) {
    const span = Math.abs(o.value) || 1;
    return clamp(1 - Math.abs(v - o.value) / span, 0, 1);
  }

  _placementMatches(o, ctx) {
    const { terminal } = ctx;
    const m = this.active;
    // Any cargo the player has moved during this job counts: it may have been
    // set down, stacked, or hauled on a trailer by the terminal tractor.
    const tracked = new Set([...m.placedIds, ...m.deliveredIds, ...m.liftedIds]);
    if (o.type === 'stack' && o.block) {
      if (o.block === 'any') {
        return [...m.placedIds].filter((id) => {
          const c = terminal.cargoById(id);
          return c?.slot;
        }).length;
      }
      return [...m.placedIds].filter((id) => {
        const c = terminal.cargoById(id);
        return c?.slot?.blockId === o.block;
      }).length;
    }
    if (o.type === 'deliver' && o.where) {
      const target = this._resolveTarget(o.where);
      if (!target) return m.placedIds.size;
      return [...tracked].filter((id) => {
        const c = terminal.cargoById(id);
        return c && !c.slot && this._pointInRect(c.x, c.y, target.rect);
      }).length;
    }
    if (o.type === 'place') {
      if (o.where === 'lane') return [...m.placedIds].length;
      const target = this._resolveTarget(o.where);
      if (!target) return m.placedIds.size;
      return [...tracked].filter((id) => {
        const c = terminal.cargoById(id);
        return c && this._pointInRect(c.x, c.y, target.rect);
      }).length;
    }
    return m.placedIds.size;
  }

  /* --------------------------------------------------------------- events */
  handleEvent(type, payload) {
    const m = this.active;
    if (!m || m.status !== 'running') return;
    switch (type) {
      case 'machine:horn':
        m.hornCount++;
        break;
      case 'machine:spreader':
        m.cycles++;
        break;
      case 'cargo:lifted': {
        const c = payload.cargo;
        m.liftedIds.add(c.id);
        if (!m.blockLifts) m.blockLifts = new Set();
        if (c.fromBlock) m.blockLifts.add(c.id);
        if (c.slot) m.blockLifts.add(c.id);
        if (c.vessel) m.blockLifts.add(c.id);
        this.terminal.stats.lifts++;
        break;
      }
      case 'cargo:placed': {
        const c = payload.cargo;
        m.placedIds.add(c.id);
        m.deliveredIds.add(c.id);
        if (c.kind === 'container') this.terminal.stats.containersMoved++;
        break;
      }
      case 'cargo:rejected': {
        if (payload.code === 'capacity' || payload.code === 'capacity-row' || payload.code === 'radius') m.overcapacityAttempts++;
        if (payload.code === 'attachment' || payload.code === 'spreader-size' || payload.code === 'align') m.wrongAttachmentAttempts++;
        break;
      }
      case 'machine:impact':
        m.impacts.push({ at: m.elapsed, severity: payload.severity });
        break;
      case 'safety:event':
        m.safetyEvents++;
        break;
      case 'terminal:damage':
        this.terminal.stats.damage++;
        break;
    }
  }

  /** Tag a container when it is lifted out of a block so liftFromBlock works. */
  tagLiftOrigin(cargo) {
    if (cargo.slot) cargo.fromBlock = cargo.slot.blockId;
    else if (cargo.vessel) cargo.fromBlock = 'vessel';
    else if (cargo.truck) cargo.fromBlock = 'truck';
  }

  /* ------------------------------------------------------------- finish */
  _complete() {
    const m = this.active;
    m.status = 'completed';
    m.completedAt = performance.now();
    this.completedIds.add(m.id);
    this.bus?.emit('mission:complete', { mission: m });
    this.onComplete?.(m);
  }
  _fail(reason, objective = null) {
    const m = this.active;
    if (m.status !== 'running') return;
    m.status = 'failed';
    m.failReason = reason;
    m.failedObjective = objective?.label || null;
    this.bus?.emit('mission:failed', { mission: m, reason, objective });
    this.onFail?.(m, reason);
  }
  abort() {
    if (this.active?.status === 'running') { this.active.status = 'aborted'; this.bus?.emit('mission:aborted', { mission: this.active }); }
    this.active = null;
  }

  /* ------------------------------------------------------------- helpers */
  _resolveTarget(spec) {
    if (!spec) return null;
    if (typeof spec === 'object') return spec;
    const [kind, id] = String(spec).split(':');
    const T = this.terminal;
    if (kind === 'zone') {
      const z = T.zones.find((q) => q.id === id);
      return z ? { id: z.id, name: z.name, rect: z.rect } : null;
    }
    if (kind === 'pad') {
      const pad = T.layout.trainingPads.find((p) => p.id === id);
      return pad ? { id: pad.id, name: `Pad ${pad.label}`, rect: pad } : null;
    }
    if (kind === 'area') {
      const a = T.layout.areas.find((q) => q.id === id);
      return a ? { id: a.id, name: a.name, rect: a.rect } : null;
    }
    if (kind === 'block') {
      const b = T.blocks.get(id);
      return b ? { id: b.id, name: b.name, rect: b.rect } : null;
    }
    if (kind === 'berth') {
      const b = T.layout.berths.find((q) => q.id === id);
      return b ? { id: b.id, name: b.name, rect: { x: b.x - b.length / 2, y: 30, w: b.length, h: 22 } } : null;
    }
    return null;
  }
  _pointInRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  _distanceToRect(x, y, r) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  /** Human-readable objective line, used before translations are applied. */
  describeObjective(o) {
    const t = this.i18n?.t?.bind(this.i18n) ?? ((k) => k);
    const name = (spec) => this._resolveTarget(spec)?.name ?? spec ?? '';
    switch (o.type) {
      case 'reach': return `Drive to ${name(o.target)}`;
      case 'park': return `Park on ${name(o.where)}`;
      case 'stop': return 'Come to a full stop';
      case 'move': return `Drive ${o.distance} m`;
      case 'reverse': return `Reverse ${o.distance} m`;
      case 'horn': return 'Sound the horn';
      case 'cycle': return 'Cycle the spreader';
      case 'lift': return `Lift ${o.count ?? 1} ${o.cargo}`;
      case 'liftAny': return `Handle ${o.count ?? 1} load(s)`;
      case 'liftId': return `Retrieve ${o.label ?? 'the nominated container'}`;
      case 'liftFromBlock': return `Lift ${o.count ?? 1} out of ${o.block === 'any' ? 'a yard block' : o.block}`;
      case 'stack': return `Stack ${o.count ?? 1} in ${o.block === 'any' ? 'a yard block' : o.block}`;
      case 'deliver': return `Deliver to ${name(o.where)}`;
      case 'place': return `Set down at ${name(o.where)}`;
      case 'clean': return 'Finish with no safety events';
      case 'damage': return 'Do not damage cargo';
      case 'axis': return `${o.axis} ${o.op} ${o.value}`;
      default: return o.label || o.type;
    }
  }

  /** Short progress string for the HUD ("2/3 done"). */
  progressText() {
    const m = this.active;
    if (!m) return '';
    const done = m.objectives.filter((o) => o.state === OBJECTIVE_STATE.DONE).length;
    const current = m.objectives.find((o) => o.state === OBJECTIVE_STATE.PENDING);
    return {
      done, total: m.objectives.length,
      ratio: m.objectives.length ? done / m.objectives.length : 0,
      currentLabel: current?.label ?? '',
      currentHint: current?.hint ?? '',
      currentProgress: current?.progress ?? 0,
      time: m.timeLimit ? fmtTime(m.remaining) : null,
      urgent: m.timeLimit ? m.remaining < 30 : false
    };
  }
}

export default MissionManager;
