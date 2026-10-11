/**
 * Game.js — one play session: the terminal, the machines, the camera and the
 * fixed-step update that ties simulation, missions, scoring and presentation
 * together.
 *
 * Modes
 *   academy : guided lessons with the Mentor stepping through objectives
 *   career  : sequenced jobs with XP, credits, medals and unlocks
 *   free    : sandbox with optional job-board tasks — no timers, no failure
 */
import { Terminal } from '../sim/Terminal.js';
import { AttachmentSystem } from '../sim/Attachments.js';
import { Camera } from '../engine/Camera.js';
import { TerrainRenderer } from '../render/TerrainRenderer.js';
import { Renderer } from '../render/Renderer.js';
import { InputManager } from '../engine/InputManager.js';
import { MissionManager, OBJECTIVE_STATE } from './MissionManager.js';
import { ScoringSystem } from './ScoringSystem.js';
import { Progression } from './Progression.js';
import { createMachine } from './createMachine.js';
import { clamp, dist, fmtTime, rgba } from '../engine/Utils.js';

/**
 * Parked positions. The yard is stacked 3 rows deep per block, so machines
 * belong in the aisles between blocks (or straddling one, in the RTG's case).
 */
const SPAWN = {
  forklift: { x: 139, y: 141.5, angle: 0 },
  reachstacker: { x: 139, y: 103.5, angle: 0 },
  rtg: { x: 98, y: 94.1, angle: 0 },            // gantry straddling Block N1
  harborcrane: { x: 68, y: 46, angle: 0 },
  tractor: { x: 240, y: 50, angle: Math.PI }
};

/**
 * Pixels per metre for a machine when it takes the cab: big iron needs to be
 * seen from further back to be useful, the forklift sits closer.
 */
const FRAME_ZOOM = {
  forklift: 15, tractor: 14, reachstacker: 11.5, rtg: 9.5, harborcrane: 8
};

export class Game {
  constructor(deps) {
    Object.assign(this, deps);   // bus, i18n, save, settings, audio, screens, machines, layout, missions, lessons
    this.state = 'boot';         // boot | menu | playing | paused
    this.mode = 'free';
    this.world = null;
    this.vehicles = [];
    this.player = null;
    this.missionManager = new MissionManager({
      terminal: null, bus: this.bus, i18n: this.i18n, settings: this.settings,
      attachments: null, save: this.save
    });
    this.scoring = new ScoringSystem({ terminal: null, settings: this.settings, i18n: this.i18n });
    this.progression = new Progression({ save: this.save, bus: this.bus, i18n: this.i18n, missions: this.career, lessons: this.lessons, machines: this.machines });
    this.freeSetup = { ...this.save.profile.freeSetup };
    this.lastResult = null;
    this.canSwitch = false;
    this.touchEnabled = false;
    this.safety = { pedestrianEvents: 0, zoneEvents: 0, unstableEvents: 0, highForkTravel: 0, emptyRuns: 0 };
    this.overlayFlags = { jobs: true, traffic: true, safety: true, zones: false };
  }

  /* ==================================================================== boot */
  async createWorld() {
    const terminal = new Terminal(this.layout, this.bus);
    const terrain = new TerrainRenderer(this.layout);
    terminal.terrain = terrain;
    const camera = new Camera({ zoom: 4.6, minZoom: 1.35, maxZoom: 13, bounds: terminal.bounds });
    camera.followSmoothing = 4.2;
    const renderer = new Renderer(this.canvas, { terminal, camera, terrain, bus: this.bus, quality: this.settings.get('quality') });
    const attachments = new AttachmentSystem(terminal, this.bus);

    this.world = { terminal, terrain, camera, renderer, attachments };
    this.missionManager.terminal = terminal;
    this.missionManager.attachments = attachments;
    this.scoring.terminal = terminal;
    this.mentor.terminal = terminal;

    // build every machine so they all exist in the world at once
    this.vehicles = [];
    for (const [type, spec] of Object.entries(this.machines)) {
      const pos = SPAWN[type] || SPAWN.forklift;
      const v = createMachine(spec, { terminal, bus: this.bus, id: type + '-1', ...pos });
      v.type = type;
      v.emitter = this.bus;
      this.vehicles.push(v);
      terminal.machineHandles.push(v);
    }
    this.player = this.vehicles[0];
    this.setPlayer(this.player.type, { silent: true });
    this.missionManager.mentor = this.mentor;
    this.mentor.hook(this.bus);
    this._wireSessionEvents();
    return this.world;
  }

  _wireSessionEvents() {
    if (this._sessionWired) return;
    this._sessionWired = true;

    this.bus.on('cargo:lifted', ({ vehicle, cargo }) => {
      if (vehicle !== this.player) return;
      this.missionManager.tagLiftOrigin(cargo);
      this.missionManager.handleEvent('cargo:lifted', { vehicle, cargo });
      this.bus.emit('save:checkpoint', { reason: 'lift' });
    });
    this.bus.on('cargo:placed', ({ vehicle, cargo }) => {
      if (vehicle !== this.player) return;
      this.missionManager.handleEvent('cargo:placed', { vehicle, cargo });
    });
    this.bus.on('cargo:rejected', (p) => {
      if (p.vehicle !== this.player) return;
      this.missionManager.handleEvent('cargo:rejected', p);
    });
    this.bus.on('machine:impact', (p) => {
      this.missionManager.handleEvent('machine:impact', p);
      const heavy = p.severity > 1.1;
      if (this.settings.get('cameraShake')) this.world?.camera.shake(clamp(p.severity * 0.5, 0.1, 0.9));
      if (heavy) this.bus.emit('safety:event', { kind: 'impact' });
    });
    this.bus.on('machine:horn', () => this.missionManager.handleEvent('machine:horn', {}));
    this.bus.on('machine:spreader', () => this.missionManager.handleEvent('machine:spreader', {}));
    this.bus.on('mission:complete', ({ mission }) => this._onMissionComplete(mission));
    this.bus.on('mission:failed', ({ mission, reason }) => this._onMissionFailed(mission, reason));
    this.bus.on('mentor:debriefRequested', () => { /* handled inside _finishMission */ });
  }

  /* ================================================================ sessions */
  startFree(options = {}) {
    const machine = options.machine || this.freeSetup.machine || 'forklift';
    this.freeSetup = { ...this.freeSetup, ...options, machine };
    this.save.profile.freeSetup = { ...this.freeSetup };
    this.save.profile.lastMode = 'free';
    this.save.saveProfile();
    this.overlayFlags = {
      jobs: options.jobs ?? true, traffic: options.traffic ?? true,
      safety: options.safety ?? true, zones: options.overlays ?? false
    };
    this.enterPlay({ mode: 'free', machine, mission: null });
    this.screens.showScreen('none');
    this.toast('toast.missionStarted', { name: this.i18n.t('mode.free') });
    if (this.overlayFlags.jobs) this.mentor.sayIfNotSeen('mentor.freeIntro', [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
  }

  startLesson(id) {
    const def = (this.lessons.lessons || []).find((l) => l.id === id);
    if (!def) return;
    this.enterPlay({ mode: 'academy', machine: def.machine, mission: def });
    this.screens.showScreen('none');
    this.audio?.startEngine?.(this.player);
  }

  startCareer(id) {
    const def = (this.career.career?.missions || []).find((m) => m.id === id);
    if (!def) return;
    this.enterPlay({ mode: 'career', machine: def.machine, mission: def });
    this.screens.showScreen('none');
    this.audio?.startEngine?.(this.player);
  }

  enterPlay({ mode, machine, mission }) {
    this.mode = mode;
    this.state = 'playing';
    this.overlayFlags = mode === 'free' ? this.overlayFlags : { jobs: false, traffic: true, safety: true, zones: this.settings.get('showZones') };
    // an academy/career job may hand you a machine you have not unlocked yet
    this.canSwitch = mode === 'free';
    this.setPlayer(machine, { silent: true });
    this.safety = { pedestrianEvents: 0, zoneEvents: 0, unstableEvents: 0, highForkTravel: 0, emptyRuns: 0 };
    if (mission) {
      this.missionManager.start(mission, { mode, machine });
      this.save.profile.lastMission = mission.id;
      this.save.profile.lastMode = mode;
      this.save.saveProfile();
      this.hud.setMission(this.missionManager.active);
    } else {
      this.missionManager.stop(true);
      this.hud.setMission(null);
    }
    this.progression.markOperated(machine);
    this.hud.setMachines(this.canSwitch ? this.progression.machinesAvailable() : [machine], machine);
    this.hud.show(true);
    this.touch?.setEnabled(this.touchEnabled);
    this.audio?.unlock?.();
    this.audio?.startEngine?.(this.player);
    this.loop?.resume?.();
    this.state = 'playing';
  }

  /** Switch the machine under the player's control (free ops only). */
  setPlayer(type, { silent = false } = {}) {
    const v = this.vehicles.find((x) => x.type === type) || this.player;
    if (!v) return;
    this.player = v;
    this.hud?.setMachines(this.canSwitch ? this.progression.machinesAvailable() : [type], type);
    this.touch?.setMachine(v);
    const cam = this.world?.camera;
    if (cam) cam.snapTo(v.x, v.y, FRAME_ZOOM[type] ?? 9.4);
    if (!silent) {
      this.audio?.startEngine?.(v);
      this.bus.emit('player:machine', { machine: type, vehicle: v });
    }
  }

  continueSession() {
    const last = this.save.profile.lastMission;
    if (!last) return this.startFree({});
    const academy = (this.lessons.lessons || []).find((l) => l.id === last);
    if (academy) return this.startLesson(last);
    const career = (this.career.career?.missions || []).find((m) => m.id === last);
    if (career) return this.startCareer(last);
    this.startFree({});
  }

  lastSessionSummary() {
    const last = this.save.profile.lastMission;
    if (!last) return null;
    const all = [...(this.lessons.lessons || []), ...(this.career.career?.missions || [])];
    const def = all.find((d) => d.id === last);
    if (!def) return null;
    return `${def.title} · ${this.i18n.t(def.id.startsWith('academy') ? 'mode.academy' : 'mode.career')}`;
  }

  newGame() {
    this.save.eraseAll();
    this.reloadProfile();
    this.mentor.startTutorial();
    this.screens.showScreen('menu');
    this.screens.refreshMenu();
  }

  reloadProfile() {
    this.save.loadProfile();
    this.screens.refreshMenu();
    this.hud.setMachines(this.progression.machinesAvailable(), this.player?.type);
  }

  /* =================================================================== loop */
  update(dt) {
    if (this.state === 'menu' || this.state === 'boot') { this._attract(dt); return; }
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const { terminal, camera, attachments } = this.world;
    const v = this.player;

    // ---- input → controls ------------------------------------------------
    const input = this.input;
    const controls = {
      throttle: this.state === 'playing' ? input.throttleAxis() : 0,
      steer: this.state === 'playing' ? input.steerAxis() : 0,
      brake: this.state === 'playing' ? input.isDown('brake') : true,
      auxUp: this.state === 'playing' && input.isDown('auxUp'),
      auxDown: this.state === 'playing' && input.isDown('auxDown'),
      auxLeft: this.state === 'playing' && input.isDown('auxLeft'),
      auxRight: this.state === 'playing' && input.isDown('auxRight'),
      cycle: this.state === 'playing' && input.pressed('cycle'),
      interact: this.state === 'playing' && input.pressed('interact'),
      horn: this.state === 'playing' && input.pressed('horn')
    };

    // Discrete actions. Tractor coupling is handled inside Tractor.updateAxes;
    // every lifting machine routes its load action through AttachmentSystem.
    if (controls.interact && v.type !== 'tractor') attachments.toggle(v);
    if (controls.horn) v.hornBlast ? v.hornBlast() : this.bus.emit('machine:horn', { vehicle: v });

    v.update(dt, controls);
    for (const other of this.vehicles) if (other !== v) other.update(dt, IDLE_CONTROLS);

    terminal.update(dt, { player: v, traffic: this.overlayFlags.traffic });

    // ---- safety surveillance --------------------------------------------
    this._watchSafety(dt, v);

    // ---- mission evaluation ---------------------------------------------
    const ctx = this._buildContext(v, dt);
    this.missionManager.update(dt, ctx);   // lesson choreography is driven from inside

    // ---- camera ----------------------------------------------------------
    camera.follow(v.x, v.y, dt, v.vx, v.vy);
    this._handleCameraInput(dt);
    camera.update(dt);

    // ---- engine audio ----------------------------------------------------
    this.audio?.updateEngine?.(v, dt);

    // edges are per-step: consume them once the frame's actions are resolved
    this.input.endStep();
  }

  /**
   * Menu backdrop: a slow, looping fly-over of the live terminal (quay, ships,
   * then down into the yard). Costs nothing extra: it is the normal renderer.
   */
  _attract(dt) {
    const w = this.world;
    if (!w) return;
    this._attractT = (this._attractT || 0) + dt;
    const t = this._attractT * 0.035;                 // one loop ~ 3 minutes
    const cam = w.camera;
    const px = 186 + Math.sin(t * 2 * Math.PI) * 112;
    const py = 56 + (Math.cos(t * 2 * Math.PI * 0.5) * 0.5 + 0.5) * 62;
    cam.x = px; cam.y = py;
    cam.zoom = cam.targetZoom = 6.2;
    w.terminal.update?.(dt);
  }

  render(alpha, dt, paused) {
    if (!this.world) return;
    const state = this._renderState();
    this.world.renderer.render(paused ? 0 : dt, state);
    if (!paused) {
      this.hud.update(dt, this._buildContext(this.player));
      this.touch?.setMachine(this.player);
    }
  }

  _renderState() {
    const v = this.player;
    const attachments = this.world.attachments;
    let ghost = null, liftTarget = null, pedNear = null;
    if (v && !v.load) {
      const cands = attachments.candidates(v);
      if (cands.length) liftTarget = cands[0].cargo;
    }
    if (v?.load) {
      const place = attachments.evaluatePlace(v);
      const rest = v.releasePoint ? v.releasePoint() : v.gripPoint();
      ghost = {
        x: rest.x, y: rest.y,
        w: v.load.length, h: v.load.width,
        valid: !!place?.ok
      };
    }
    const ped = this.world.terminal.pedestrianNear?.(v?.x ?? 0, v?.y ?? 0, 7);
    pedNear = ped?.ped || null;
    return {
      vehicles: this.vehicles,
      player: v,
      ghost,
      liftTarget,
      markers: this.markers(),
      pedNear,
      fade: 0
    };
  }

  /** Objective markers for the world and the minimap. */
  markers() {
    const m = this.missionManager.active;
    if (!m || !this.settings.get('showMarkers')) return [];
    const out = [];
    const current = m.objectives.find((o) => o.state === OBJECTIVE_STATE.PENDING);
    if (current) {
      const t = this.missionManager._resolveTarget(current.target || current.where);
      if (t) out.push({ x: t.rect.x + t.rect.w / 2, y: t.rect.y + t.rect.h / 2, radius: Math.max(4, Math.min(t.rect.w, t.rect.h) * 0.5), color: '#ffc53d', label: current.label });
    }
    // free operations: highlight the nearest free yard slot as a hint
    if (this.mode === 'free' && this.player?.load && this.settings.get('showMarkers')) {
      const slot = this.world.terminal.nearestFreeSlot?.(this.player.x, this.player.y, this.player.load.size);
      if (slot) out.push({ x: slot.x, y: slot.y, radius: 3.4, color: '#22c8b8', label: 'free slot' });
    }
    return out;
  }

  _handleCameraInput(dt) {
    const input = this.input;
    const cam = this.world.camera;
    if (input.isDown('zoomIn')) cam.zoomBy(dt * 1.4);
    if (input.isDown('zoomOut')) cam.zoomBy(-dt * 1.4);
    if (input.pressed('recenter')) cam.snapTo(this.player.x, this.player.y, FRAME_ZOOM[this.player?.type] ?? 9.4);
    const panX = input.axis('panLeft', 'panRight');
    const panY = input.axis('panUp', 'panDown');
    if (panX || panY) cam.manual.x += panX * dt * 26;
    if (panY) cam.manual.y += panY * dt * 26;
  }

  _watchSafety(dt, v) {
    if (!v) return;
    const T = this.world.terminal;
    // pedestrians
    const ped = T.pedestrianNear?.(v.x, v.y, Math.max(4, v.speed * 1.6));
    if (ped && Math.abs(v.speed) > 0.6) {
      if (performance.now() - (this._lastPedWarn || 0) > 8000) {
        this._lastPedWarn = performance.now();
        this.safety.pedestrianEvents++;
        this.bus.emit('safety:pedestrian', { pedestrian: ped });
        this.bus.emit('safety:event', { kind: 'pedestrian' });
        this.bus.emit('toast', { key: 'toast.pedNear', icon: 'warn', tone: 'bad' });
      }
    }
    // restricted zones
    const rz = T.restrictedAt?.(v.x, v.y);
    if (rz) {
      if (this._inZone !== rz.id) {
        this._inZone = rz.id;
        this._zonesSeen = this._zonesSeen || new Set();
        const first = !this._zonesSeen.has(rz.id);
        this._zonesSeen.add(rz.id);
        if (first) this.safety.zoneEvents++;
        this.bus.emit('safety:zoneEntered', { zone: rz.id, name: rz.name || rz.id });
        this.bus.emit('safety:event', { kind: 'zone', zone: rz.id });
      }
    } else if (this._inZone) {
      this._inZone = null;
    }
    // raised forks while travelling (forklift only)
    if (v.type === 'forklift') {
      const raised = (v.forkHeight ?? 0) > 1.5;
      if (raised && Math.abs(v.speed) > 0.8) {
        this.safety.highForkTravel += dt;
        if (this.safety.highForkTravel > 6 && !this._highForkWarned) {
          this._highForkWarned = true;
          this.bus.emit('safety:event', { kind: 'raised-forks' });
          this.bus.emit('toast', { key: 'mentor.forks', icon: 'warn', tone: 'warn' });
        }
      }
    }
  }

  _buildContext(v, dt = 0) {
    return {
      dt,
      vehicle: v,
      terminal: this.world.terminal,
      camera: this.world.camera,
      markers: this.markers(),
      vehicles: this.vehicles,
      mission: this.missionManager.active,
      pedestrianEvents: this.safety.pedestrianEvents,
      zoneEvents: this.safety.zoneEvents,
      highForkTravel: this.safety.highForkTravel,
      rehandleCount: 0,
      misplacedCount: 0
    };
  }

  /* ================================================================ results */
  _onMissionComplete(mission) {
    this._finishMission(mission, true);
  }
  _onMissionFailed(mission, reason) {
    this._finishMission(mission, false, reason);
  }

  _finishMission(mission, completed, reason) {
    this.state = 'paused';
    this.loop?.pause?.();
    this.audio?.stopEngine?.();
    const ctx = this._buildContext(this.player);
    const result = this.scoring.compute(mission, ctx);
    result.summary = completed
      ? this.mentor.debrief(mission, result).join(' ')
      : this._failSummary(mission, reason);
    const rewards = this.scoring.rewards(mission, result);
    if (completed) {
      const before = this.save.profile.missions[mission.id]?.best ?? -1;
      const rec = this.progression.recordMission(mission, result);
      result.newBest = result.score > before;
      const award = this.progression.award({ ...rewards, xp: rewards.xp, credits: rewards.credits }, mission);
      rewards.level = award.level;
      rewards.levelUp = award.levelled;
      const unlocked = this.progression.applyUnlocks(mission.def);
      const achievements = this.progression.checkAchievements({
        perfectEquipment: result.breakdown.equipment >= 100,
        noDamageStreak: this.save.profile.stats.impactFree
      });
      if (result.medal) this.audio?.medal?.(result.medal);
      this.mentor.markLessonDone(mission.id);
      this.missionManager.active.completedRecord = rec;
      this.screens.showResult({
        mission, result, rewards, unlocked, achievements,
        onRetry: () => this.restart(),
        onNext: () => this.nextAfter(mission),
        nextLabel: this._nextLabel(mission)
      });
    } else {
      this.save.profile.stats.missionsFailed = (this.save.profile.stats.missionsFailed || 0) + 1;
      this.save.saveProfile();
      this.screens.showResult({ mission, result, rewards: { xp: 0, credits: 0 }, onRetry: () => this.restart(), nextLabel: null });
    }
    this.lastResult = { mission, result, completed };
  }

  _failSummary(mission, reason) {
    const key = { time: 'objective.timeLimit', safety: 'objective.zeroEvents', damage: 'objective.noDamage' }[reason] || 'objective.timeLimit';
    const lead = this.i18n.t('lesson.failed');
    const why = this.i18n.t(key);
    const tip = mission.def.tips?.[0] ? ` ${mission.def.tips[0]}` : '';
    return `${lead} ${why}.${tip}`;
  }

  nextAfter(mission) {
    const list = mission.mode === 'academy' ? (this.lessons.lessons || []) : (this.career.career?.missions || []);
    const idx = list.findIndex((d) => d.id === mission.id);
    const next = list[idx + 1];
    if (!next) return this.toMenu();
    if (mission.mode === 'academy') this.startLesson(next.id);
    else this.startCareer(next.id);
  }

  _nextLabel(mission) {
    const list = mission.mode === 'academy' ? (this.lessons.lessons || []) : (this.career.career?.missions || []);
    const idx = list.findIndex((d) => d.id === mission.id);
    const next = list[idx + 1];
    return next ? `${this.i18n.t('mission.next')}: ${next.title}` : this.i18n.t('common.menu');
  }

  /* ================================================================== pause */
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop?.pause?.();
    this.audio?.stopEngine?.();
    this.touch?.releaseAll();
    this.screens.openPause();
    this.bus.emit('game:paused', {});
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.loop?.resume?.();
    this.audio?.startEngine?.(this.player);
    this.bus.emit('game:resumed', {});
  }
  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused' && !this.screens.overlayOpen) this.resume();
  }
  restart() {
    const active = this.missionManager.active;
    const mode = this.mode;
    const id = active?.id || this.save.profile.lastMission;
    if (mode === 'academy' && id) return this.startLesson(id);
    if (mode === 'career' && id) return this.startCareer(id);
    return this.startFree(this.freeSetup);
  }
  toMenu() {
    this.state = 'menu';
    this.loop?.pause?.();
    this.audio?.stopEngine?.();
    this.missionManager.stop(true);
    this.hud.show(false);
    this.touch?.setEnabled(false);
    this.screens.showScreen('menu');
    this.save.saveProfile(true);
    this.bus.emit('game:menu', {});
  }
  exitApp() {
    // A browser cannot close a tab it did not open; explain instead of faking it.
    this.screens.confirm({
      title: this.i18n.t('menu.exit'),
      text: this.i18n.t('menu.exit.text'),
      yes: this.i18n.t('common.ok'),
      no: this.i18n.t('common.cancel'),
      onYes: () => {
        this.toMenu();
        this.bus.emit('toast', { text: this.i18n.t('menu.exit.close'), icon: 'exit', tone: 'muted', life: 4200 });
        try { window.close(); } catch (e) { /* browsers block this — the toast explains */ }
      }
    });
  }
  pauseSettings() { this.state = 'paused'; }

  /* ================================================================= helpers */
  toast(key, vars) { this.bus.emit('toast', { key, vars }); }

  currentControls() {
    const v = this.player;
    if (!v) return [];
    const bindings = this.settings.get('bindings') || {};
    return (v.spec.controls || []).map((c) => ({
      keys: (bindings[c.action] || []).map((x) => String(x).replace('Key', '').replace('Arrow', '')).join('/'),
      label: c.label
    }));
  }

  /** Used by the settings screen to capture a new key. */
  captureBinding(action, resolve) {
    if (!this.input) return resolve(null);
    this.input.beginRebind(action, (code) => resolve(code));
  }
}

const IDLE_CONTROLS = Object.freeze({
  throttle: 0, steer: 0, brake: false, auxUp: false, auxDown: false,
  auxLeft: false, auxRight: false, cycle: false, interact: false, horn: false
});

export default Game;
