/**
 * Mentor.js — THE PORT MENTOR.
 *
 * A deterministic, offline instructor: no AI, no network. He has
 *   • a scripted tutorial that opens a new career,
 *   • lesson choreography for the Academy,
 *   • a contextual help system driven by the player's machine and job,
 *   • a memory of what he has already said (saved locally) so he does not nag.
 *
 * Personality rules: short lines, one idea at a time, never interrupts while
 * the player is busy unless a safety event just happened.
 */
import { clamp, dist } from '../engine/Utils.js';

export const MENTOR_TOPICS = ['objective', 'controls', 'equipment', 'safety', 'general', 'lesson', 'glossary'];

export class Mentor {
  constructor({ bus, i18n, save, terminal, missions, settings }) {
    this.bus = bus;
    this.i18n = i18n;
    this.save = save;
    this.terminal = terminal;
    this.missions = missions;
    this.settings = settings;
    this.lines = {};
    this.queue = [];
    this.history = [];
    this.cooldowns = new Map();
    this.stuckTimer = 0;
    this.lastStuckAt = 0;
    this.hintsUsed = 0;
    this.open = false;
    this.onSpeak = null;
    this._boundEvents = false;
  }

  async load(path = 'src/data/dialogue.json') {
    const res = await fetch(path, { cache: 'force-cache' });
    this.lines = await res.json();
    return this;
  }

  /** Localised dialogue line. */
  line(id, vars = {}) {
    const entry = this.lines[id];
    if (!entry) return id;
    const lang = this.i18n?.lang || 'en';
    let text = entry[lang] || entry.en || '';
    text = text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return text;
  }

  /* ------------------------------------------------------------- memory --- */
  get memory() { return this.save.profile.tutorial; }
  hasSeen(id) { return !!this.memory.seen[id]; }
  markSeen(id) {
    if (!this.memory.seen[id]) { this.memory.seen[id] = Date.now(); this.save.saveProfile(); }
  }
  lessonDone(id) { return this.memory.completed.includes(id); }
  markLessonDone(id) {
    if (!this.lessonDone(id)) {
      this.memory.completed.push(id);
      this.save.saveProfile();
    }
  }

  /* -------------------------------------------------------------- speaking */
  /**
   * Show a dialogue. `say` accepts an array of dialogue ids or {id, vars}.
   * `options` are {label, action} entries rendered as buttons.
   */
  say(say, options = [], { force = false, topic = null } = {}) {
    const list = Array.isArray(say) ? say : [say];
    const texts = list.map((s) => (typeof s === 'string'
      ? this.line(s)
      : this.line(s.id, s.vars || {}))).filter(Boolean);
    if (!texts.length) return;
    const now = performance.now();
    const key = list.map((s) => (typeof s === 'string' ? s : s.id)).join('|');
    const last = this.cooldowns.get(key) || 0;
    if (!force && now - last < 9000) return;      // never repeat the same line quickly
    this.cooldowns.set(key, now);
    for (const t of texts) this.history.push(t);
    if (this.history.length > 40) this.history.splice(0, 20);
    this.markSeen(key);
    this.open = true;
    this.currentOptions = options;
    this.onSpeak?.({ texts, options, topic });
    this.bus?.emit('mentor:speak', { texts, options, topic });
  }

  sayIfNotSeen(id, options = [], vars = {}) {
    if (this.hasSeen(id)) return false;
    this.say([{ id, vars }], options);
    this.markSeen(id);
    return true;
  }

  close() {
    this.open = false;
    this.currentOptions = null;
    this.bus?.emit('mentor:close', {});
  }

  /* ------------------------------------------------------- scripted intro */
  /** Opening tutorial beats for a brand-new career. */
  startTutorial() {
    const t = this.memory;
    if (t.skipped) return;
    this.say(['mentor.welcome', 'mentor.welcome2', 'mentor.safetyFirst', 'mentor.hud', 'mentor.hud2', 'mentor.map'],
      [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }],
      { force: true, topic: 'tutorial' });
    t.current = 'intro';
    this.save.saveProfile();
  }

  skipTutorial() {
    this.memory.skipped = true;
    this.memory.current = null;
    this.save.saveProfile();
    this.bus?.emit('tutorial:skipped', {});
  }

  /* ---------------------------------------------------------- lesson flow */
  /** Called every step while an Academy lesson runs. */
  updateLesson(mission, ctx) {
    const def = mission.def;
    const steps = def.dialogue || [];
    const doneCount = mission.objectives.filter((o) => o.state === 'done').length;
    const wanted = clamp(doneCount, 0, Math.max(0, steps.length - 1));
    if (wanted > (mission._mentorStep ?? -1)) {
      mission._mentorStep = wanted;
      const id = steps[wanted];
      if (id) {
        this.say([{ id }], [
          { label: this.i18n.t('mentor.next'), action: 'close', primary: true },
          { label: this.i18n.t('mentor.topic.objective'), action: 'topic:objective' }
        ], { topic: 'lesson' });
      }
    }
    // offer a hint if the player has been stationary on the same objective
    const current = mission.objectives.find((o) => o.state === 'pending');
    if (current && this.settings?.get('mentorNudges')) {
      const moving = Math.abs(ctx.vehicle?.speed ?? 0) > 0.3;
      if (!moving) this.stuckTimer += ctx.dt ?? 0; else this.stuckTimer = 0;
      if (this.stuckTimer > 26) {
        this.stuckTimer = 0;
        this.say([{ id: 'mentor.hintStuck', vars: { hint: current.hint || current.label } }],
          [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }], { topic: 'hint' });
      }
    }
  }

  /** Debrief line after a lesson or mission. */
  debrief(mission, result) {
    const lines = [];
    if (result.perfect) lines.push('mentor.debriefPerfect');
    else if (result.score >= 70) lines.push({ id: 'mentor.debriefGood', vars: { weakness: this.i18n.t(`mentor.weakness.${result.weakest}`) } });
    else lines.push({ id: 'mentor.debriefPoor', vars: { weakness: this.i18n.t(`mentor.weakness.${result.weakest}`) } });
    if (mission.mode === 'academy' && mission.status === 'completed') {
      const def = mission.def;
      if (def.id === 'academy-forklift-3') lines.push('mentor.nextStage');
      else if (def.id === 'academy-rtg-1') lines.push('mentor.harborIntro');
      else lines.push({ id: 'mentor.appreciation' });
    }
    return lines.map((l) => (typeof l === 'string' ? this.line(l) : this.line(l.id, l.vars)));
  }

  /* -------------------------------------------------------- contextual help */
  /**
   * The Ask-the-Mentor panel: builds the answer for a topic using the live
   * machine and the active job so the advice is always relevant.
   */
  answer(topic, ctx = {}) {
    const { vehicle, mission } = ctx;
    const m = vehicle?.spec;
    const t = this.i18n.t.bind(this.i18n);
    switch (topic) {
      case 'objective': {
        if (!mission) return this.line('mentor.askNoObjective');
        const p = this.missions.progressText();
        const progress = `${p.done}/${p.total}${p.time ? ` · ${t('hud.timer') || 'time'} ${p.time}` : ''}`;
        return this.line('mentor.askObjective', { objective: p.currentLabel || mission.title, progress });
      }
      case 'controls': {
        if (!m) return this.line('mentor.askGeneral');
        const ctl = (m.controls || []).map((c) => `${ctx.keyLabel ? ctx.keyLabel(c.action) : c.action} — ${c.label}`).join(', ');
        return this.line('mentor.askControls', { machine: m.name, controls: ctl });
      }
      case 'equipment': {
        if (!m) return this.line('mentor.askGeneral');
        const tips = (m.trainingTips || []).join(' ');
        return this.line('mentor.askEquipment', { description: m.description, tips });
      }
      case 'safety':
        return this.line('mentor.askSafety');
      case 'lesson': {
        if (!mission || mission.mode !== 'academy') return this.line('mentor.noLesson');
        const cur = mission.objectives.find((o) => o.state === 'pending');
        if (!cur) return this.line('mentor.appreciation');
        const n = mission.objectives.indexOf(cur) + 1;
        return this.line('mentor.lessonStep', {
          n, total: mission.objectives.length,
          say: `${cur.label}. ${cur.hint || ''}`.trim()
        });
      }
      case 'glossary':
        return this.line('mentor.askGlossary');
      case 'general':
      default:
        return this.line('mentor.askGeneral');
    }
  }

  /** Topics offered in the panel, filtered by context. */
  topics(ctx = {}) {
    const t = this.i18n.t.bind(this.i18n);
    const list = [];
    if (this.missions?.active) list.push({ id: 'objective', label: t('mentor.topic.objective'), icon: 'target' });
    if (ctx.vehicle) {
      list.push({ id: 'controls', label: t('mentor.topic.controls'), icon: 'gear' });
      list.push({ id: 'equipment', label: t('mentor.topic.equipment'), icon: 'machines' });
    }
    if (this.missions?.active?.mode === 'academy') list.push({ id: 'lesson', label: t('mentor.topic.lesson'), icon: 'cap' });
    list.push({ id: 'safety', label: t('mentor.topic.safety'), icon: 'shield' });
    list.push({ id: 'glossary', label: t('mentor.topic.glossary'), icon: 'book' });
    list.push({ id: 'general', label: t('mentor.topic.general'), icon: 'help' });
    return list;
  }

  /* -------------------------------------------------------- event reactions */
  hook(bus) {
    if (this._boundEvents) return;
    this._boundEvents = true;
    bus.on('mission:started', ({ mission }) => {
      const def = mission.def;
      if (mission.mode === 'academy' && !this.hasSeen('lesson:' + def.id)) {
        const first = (def.dialogue || [])[0];
        if (first) this.say([{ id: first }], [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }], { topic: 'lesson' });
        this.markSeen('lesson:' + def.id);
      } else if (mission.mode === 'career' && !this.hasSeen('career:intro')) {
        this.sayIfNotSeen('mentor.careerIntro', [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
      } else if (mission.mode === 'free' && !this.hasSeen('free:intro')) {
        this.sayIfNotSeen('mentor.freeIntro', [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
      }
    });

    bus.on('cargo:rejected', (p) => {
      // explain a mistake once, then stay quiet about the same code
      const key = 'reject:' + p.code;
      if (this.hasSeen(key)) return;
      const map = {
        capacity: 'mentor.capacity', 'capacity-row': 'mentor.reachCapacity', radius: 'mentor.harborControls',
        attachment: 'mentor.forkliftIntro', 'spreader-size': 'mentor.reachControls', align: 'mentor.approachPallet',
        height: 'mentor.forks', blocked: 'mentor.rtgControls'
      };
      const line = map[p.code];
      if (line) this.say([line], [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }], { topic: 'correction' });
      this.markSeen(key);
    });

    bus.on('machine:impact', (p) => {
      if (!this.settings?.get('mentorNudges')) return;
      const now = performance.now();
      if (now - (this._lastDamageSay || 0) < 20000) return;
      this._lastDamageSay = now;
      this.sayIfNotSeenOrRare('mentor.damage', [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
    });

    bus.on('safety:zoneEntered', () => {
      if (!this.settings?.get('mentorNudges')) return;
      this.sayIfNotSeen('mentor.zoneWarn', [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
    });

    bus.on('safety:pedestrian', () => {
      if (!this.settings?.get('mentorNudges')) return;
      const now = performance.now();
      if (now - (this._lastPedSay || 0) < 25000) return;
      this._lastPedSay = now;
      this.say(['mentor.pedNear'], [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }]);
    });

    bus.on('mission:failed', ({ mission }) => {
      const tip = mission.def.tips?.[0] || '';
      if (mission.mode !== 'free') {
        this.say([{ id: 'mentor.retry', vars: { tip } }],
          [{ label: this.i18n.t('mentor.next'), action: 'close', primary: true }], { topic: 'retry', force: true });
      }
    });

    bus.on('mission:complete', ({ mission }) => {
      if (mission.mode !== 'free') this.bus?.emit('mentor:debriefRequested', { mission });
    });

    bus.on('progression:unlocked', ({ machine, name }) => {
      const m = ctxMachineName(machine);
      this.say([{ id: 'unlock.line', vars: { machine: m } }]);
    });
  }

  sayIfNotSeenOrRare(id, options) {
    const key = 'rare:' + id;
    const last = this.memory.seen[key] || 0;
    const now = Date.now();
    if (now - last < 120000) return;
    this.memory.seen[key] = now;
    this.save.saveProfile();
    this.say([id], options);
  }

  /* --------------------------------------------------------------- summary */
  /** Snapshot for the "learning progress" indicator in the Academy list. */
  progressSummary(lessons) {
    const done = lessons.filter((l) => this.lessonDone(l.id)).length;
    return { done, total: lessons.length, ratio: lessons.length ? done / lessons.length : 0 };
  }
  resetMemory() {
    const t = this.save.profile.tutorial;
    t.completed = [];
    t.seen = {};
    t.current = null;
    t.skipped = false;
    this.save.saveProfile();
  }
}

function ctxMachineName(id) {
  const names = { forklift: 'Counterbalance Forklift', reachstacker: 'Reach Stacker', rtg: 'RTG Gantry Crane', harborcrane: 'Mobile Harbour Crane', tractor: 'Terminal Tractor' };
  return names[id] || id;
}

export default Mentor;
