/**
 * Progression.js — experience, levels, credits, unlocks and achievements.
 * Reads/writes through SaveManager so everything ends up in local storage.
 */
import { bestMedal } from '../systems/SaveManager.js';

export const LEVEL_TITLES = [
  { level: 1, key: 'career.trainee', name: 'Trainee' },
  { level: 2, key: null, name: 'Terminal Operator' },
  { level: 3, key: null, name: 'Yard Operator' },
  { level: 4, key: null, name: 'Container Handler' },
  { level: 5, key: null, name: 'Gantry Operator' },
  { level: 6, key: null, name: 'Heavy Lift Operator' },
  { level: 8, key: null, name: 'Shift Supervisor' },
  { level: 12, key: null, name: 'Terminal Master' }
];

export class Progression {
  constructor({ save, bus, i18n, missions, machines, lessons }) {
    this.save = save;
    this.bus = bus;
    this.i18n = i18n;
    this.missionDefs = missions;
    this.lessonDefs = lessons;
    this.machineDefs = machines;
  }

  get profile() { return this.save.profile; }
  get level() { return this.save.profile.level; }
  get credits() { return this.save.profile.credits; }
  get xp() { return this.save.profile.xp; }

  title() {
    let title = LEVEL_TITLES[0].name;
    for (const t of LEVEL_TITLES) if (this.level >= t.level) title = t.name;
    if (this.i18n && title === 'Trainee') return this.i18n.t('career.trainee');
    return title;
  }
  xpInfo() { return this.save.xpProgress(this.xp); }

  /* --------------------------------------------------------------- rewards */
  award(result, mission) {
    const before = this.level;
    const level = this.save.addXp(result.xp);
    this.save.addCredits(result.credits);
    const p = this.profile;
    p.stats.missionsCompleted += 1;
    p.stats.lifts += mission.liftedIds.size;
    p.stats.distance += Math.round(mission.distance);
    if (mission.safetyEvents === 0) p.stats.impactFree += 1; else p.stats.safetyEvents += mission.safetyEvents;
    if (result.medal) p.stats.medals[result.medal] = (p.stats.medals[result.medal] || 0) + 1;
    let levelled = false;
    if (level > before) { levelled = true; this.bus?.emit('progression:levelup', { level }); }
    this.save.saveProfile();
    return { level, levelled, xp: result.xp, credits: result.credits };
  }

  recordMission(mission, result) {
    return this.save.recordMission(mission.id, {
      score: result.score,
      medal: result.medal,
      completed: mission.status === 'completed',
      breakdown: result.breakdown
    });
  }

  /* --------------------------------------------------------------- unlocks */
  /** Handle machine unlocks triggered by a mission/lesson definition. */
  applyUnlocks(def) {
    const unlocked = [];
    if (def?.unlocks && !this.save.has(def.unlocks)) {
      this.save.unlock(def.unlocks);
      unlocked.push(def.unlocks);
      const m = this.machineDefs[def.unlocks];
      this.bus?.emit('progression:unlocked', { machine: def.unlocks, name: m?.name || def.unlocks });
    }
    // implicit: finishing an academy lesson for a machine unlocks it
    if (def?.machine && !this.save.has(def.machine)) {
      const previous = this.academyComplete(def.id);
      if (previous) { this.save.unlock(def.machine); unlocked.push(def.machine); }
    }
    return unlocked;
  }
  academyComplete(_id) { return true; }
  machinesAvailable() {
    return Object.keys(this.machineDefs).filter((id) => this.save.has(id));
  }

  /* ---------------------------------------------------------- achievements */
  checkAchievements(context = {}) {
    const p = this.profile;
    const got = [];
    const give = (id) => {
      if (this.save.achievement(id)) {
        const def = this.missionDefs?.achievements?.find((a) => a.id === id);
        if (def?.credits) this.save.addCredits(def.credits);
        got.push(id);
        this.bus?.emit('progression:achievement', { id, def });
      }
    };
    if (p.stats.missionsCompleted >= 1) give('first-shift');
    if (p.stats.impactFree >= 5) give('clean-sweep');
    if ((p.stats.medals.gold || 0) >= 1) give('gold-standard');
    if (p.stats.lifts >= 50) give('heavy-lifter');
    if (context.perfectEquipment) give('smooth-operator');
    if (context.noDamageStreak >= 10) give('no-scratch');
    if (this.allCareerComplete()) give('terminal-master');
    if (p.stats.jobBoardDone >= 5) give('job-board');
    if (['forklift', 'reachstacker', 'rtg', 'harborcrane'].every((m) => this.hasOperated(m))) give('four-machines');
    if (this.allAcademyComplete()) give('academy-graduate');
    if (got.length) this.save.saveProfile();
    return got;
  }
  hasOperated(machine) {
    return (this.profile.stats.operated || []).includes(machine);
  }
  markOperated(machine) {
    const p = this.profile;
    p.stats.operated = p.stats.operated || [];
    if (!p.stats.operated.includes(machine)) { p.stats.operated.push(machine); this.save.saveProfile(); }
  }
  allCareerComplete() {
    const list = this.missionDefs?.career?.missions || [];
    return list.length > 0 && list.every((m) => this.profile.missions[m.id]?.completed);
  }
  allAcademyComplete() {
    // an empty list must never count as "all complete"
    const list = this.lessonDefs?.lessons || this.missionDefs?.academy?.lessons || [];
    return list.length > 0 && list.every((l) => this.profile.missions[l.id]?.completed);
  }

  /* ------------------------------------------------------- availability --- */
  /** Is this mission/lesson unlocked and playable? */
  isAvailable(def, allDefs) {
    if (!def.requires?.length) return true;
    return def.requires.every((id) => this.profile.missions[id]?.completed);
  }
  lockReason(def) {
    if (!def.requires?.length) return null;
    const missing = def.requires.filter((id) => !this.profile.missions[id]?.completed);
    if (!missing.length) return null;
    const names = missing.map((id) => (id.includes('academy') ? 'Academy' : 'Career') + ' · ' + id);
    return { ids: missing, text: names.join(', ') };
  }
  /** Machine available? (unlocked through progression) */
  machineAvailable(id) { return this.save.has(id); }

  summary() {
    const p = this.profile;
    return {
      level: this.level,
      title: this.title(),
      credits: p.credits,
      xp: p.xp,
      medals: p.stats.medals,
      missionsCompleted: p.stats.missionsCompleted,
      playSeconds: p.playSeconds,
      unlocked: p.unlocked,
      achievements: Object.keys(p.achievements).length
    };
  }
}

export default Progression;
