/**
 * SaveManager.js — local, offline persistence.
 *
 * Two slots live in localStorage:
 *   portops.profile.v1  → progression (career, medals, unlocks, tutorial)
 *   portops.settings.v1 → user settings
 * A third slot stores the last session so "Continue" resumes exactly where the
 * player stopped. Everything is versioned and migrated forward; export/import
 * uses the same JSON so players can move a save between devices by hand.
 */
import { clamp } from '../engine/Utils.js';

export const SAVE_VERSION = 1;
export const KEYS = {
  profile: 'portops.profile.v1',
  settings: 'portops.settings.v1',
  session: 'portops.session.v1',
  autosave: 'portops.autosave.v1'
};

export const LEVEL_CURVE = (level) => Math.round(420 * Math.pow(1.28, level - 1));

export function makeProfile() {
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    playerName: 'Operator',
    xp: 0,
    level: 1,
    credits: 300,
    playSeconds: 0,
    // --- career / academy ------------------------------------------------
    missions: {},          // id -> { score, medal, best, attempts, completedAt, breakdown }
    achievements: {},      // id -> true
    unlocked: ['forklift'],  // machine ids
    tutorial: { completed: [], current: null, lesson: 0, skipped: false, step: 0, seen: {} },
    lastMode: 'career',
    lastMission: null,
    stats: {
      missionsCompleted: 0, missionsFailed: 0, containersMoved: 0,
      lifts: 0, distance: 0, impactFree: 0, safetyEvents: 0, medals: { gold: 0, silver: 0, bronze: 0 },
      jobBoardDone: 0
    },
    jobBoard: [],
    // --- free ops (last used setup) --------------------------------------
    freeSetup: { machine: 'forklift', shift: 'open', jobs: true, traffic: true, safety: true, zones: false }
  };
}

export class SaveManager {
  constructor(bus) {
    this.bus = bus;
    this.available = this._testStorage();
    this.profile = null;
    this.settings = null;
    this._writeTimer = null;
    this.lastError = null;
  }

  _testStorage() {
    try {
      const k = '__portops_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      console.warn('[SaveManager] localStorage unavailable, using in-memory store');
      this.memory = new Map();
      return false;
    }
  }
  _get(key) {
    try { return this.available ? localStorage.getItem(key) : (this.memory.get(key) ?? null); }
    catch { return null; }
  }
  _set(key, value) {
    try {
      if (this.available) localStorage.setItem(key, value);
      else this.memory.set(key, value);
      return true;
    } catch (e) {
      this.lastError = e;
      this.bus?.emit('save:error', { error: e });
      return false;
    }
  }
  _del(key) {
    try { if (this.available) localStorage.removeItem(key); else this.memory.delete(key); } catch { /* ignore */ }
  }

  /* -------------------------------------------------------------- profile -- */
  loadProfile() {
    const raw = this._get(KEYS.profile);
    if (!raw) { this.profile = makeProfile(); return this.profile; }
    try {
      const parsed = JSON.parse(raw);
      this.profile = this._migrate(parsed);
    } catch (e) {
      console.warn('[SaveManager] corrupt profile, starting fresh', e);
      this.profile = makeProfile();
    }
    return this.profile;
  }

  _migrate(p) {
    const base = makeProfile();
    const merged = {
      ...base, ...p,
      tutorial: { ...base.tutorial, ...(p.tutorial || {}) },
      stats: { ...base.stats, ...(p.stats || {}), medals: { ...base.stats.medals, ...(p.stats?.medals || {}) } },
      freeSetup: { ...base.freeSetup, ...(p.freeSetup || {}) },
      missions: p.missions || {},
      achievements: p.achievements || {},
      unlocked: Array.from(new Set([...(p.unlocked || []), 'forklift'])),
      version: SAVE_VERSION
    };
    merged.level = this.levelForXp(merged.xp);
    return merged;
  }

  /** Debounced write so rapid state changes do not hammer localStorage. */
  saveProfile(immediate = false) {
    if (!this.profile) return;
    this.profile.updatedAt = Date.now();
    this.profile.level = this.levelForXp(this.profile.xp);
    const run = () => {
      this._writeTimer = null;
      const ok = this._set(KEYS.profile, JSON.stringify(this.profile));
      if (ok) this.bus?.emit('save:profile', { profile: this.profile });
    };
    if (immediate) { if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null; } run(); }
    else if (!this._writeTimer) this._writeTimer = setTimeout(run, 600);
  }

  /* ------------------------------------------------------------- settings -- */
  loadSettings(defaults) {
    const raw = this._get(KEYS.settings);
    let parsed = {};
    if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = {}; } }
    this.settings = { ...defaults, ...parsed };
    if (parsed.bindings) this.settings.bindings = parsed.bindings;
    return this.settings;
  }
  saveSettings(settings) {
    this.settings = { ...settings };
    this._set(KEYS.settings, JSON.stringify(this.settings));
    this.bus?.emit('save:settings', { settings: this.settings });
  }

  /* -------------------------------------------------------------- session -- */
  saveSession(session) { this._set(KEYS.session, JSON.stringify(session)); }
  loadSession() {
    const raw = this._get(KEYS.session);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  clearSession() { this._del(KEYS.session); }

  /* ------------------------------------------------------------- helpers --- */
  levelForXp(xp) {
    let level = 1, need = LEVEL_CURVE(1), total = 0;
    while (xp >= total + need && level < 40) { total += need; level++; need = LEVEL_CURVE(level); }
    return level;
  }
  xpProgress(xp) {
    let level = 1, need = LEVEL_CURVE(1), total = 0;
    while (xp >= total + need && level < 40) { total += need; level++; need = LEVEL_CURVE(level); }
    return { level, into: xp - total, need, ratio: clamp((xp - total) / need, 0, 1) };
  }

  /** Recording a finished mission: keeps personal bests and medals. */
  recordMission(id, result) {
    const p = this.profile;
    const prev = p.missions[id] || { attempts: 0, best: 0, medal: null, completed: false };
    const rec = {
      ...prev,
      attempts: prev.attempts + 1,
      lastScore: result.score,
      best: Math.max(prev.best, result.score),
      medal: bestMedal(prev.medal, result.medal),
      completed: prev.completed || result.completed,
      completedAt: result.completed ? Date.now() : prev.completedAt,
      breakdown: result.breakdown || prev.breakdown || null
    };
    p.missions[id] = rec;
    return rec;
  }
  addXp(n) { this.profile.xp += Math.max(0, Math.round(n)); this.profile.level = this.levelForXp(this.profile.xp); return this.profile.level; }
  addCredits(n) { this.profile.credits = Math.max(0, this.profile.credits + Math.round(n)); }
  unlock(machineId) {
    if (!this.profile.unlocked.includes(machineId)) {
      this.profile.unlocked.push(machineId);
      this.bus?.emit('progression:unlocked', { machine: machineId });
      return true;
    }
    return false;
  }
  has(machineId) { return this.profile.unlocked.includes(machineId); }
  achievement(id, meta = null) {
    if (this.profile.achievements[id]) return false;
    this.profile.achievements[id] = { at: Date.now(), meta };
    this.bus?.emit('progression:achievement', { id, meta });
    return true;
  }

  /* ------------------------------------------------------- export / import -- */
  exportAll() {
    return JSON.stringify({
      app: 'port-ops-simulator',
      version: SAVE_VERSION,
      exportedAt: new Date().toISOString(),
      profile: this.profile,
      settings: this.settings
    }, null, 2);
  }
  importAll(json) {
    let data;
    try { data = typeof json === 'string' ? JSON.parse(json) : json; }
    catch { return { ok: false, error: 'parse' }; }
    if (!data || data.app !== 'port-ops-simulator' || !data.profile) return { ok: false, error: 'format' };
    this.profile = this._migrate(data.profile);
    this.saveProfile(true);
    if (data.settings) this.saveSettings(data.settings);
    this.bus?.emit('save:imported', { profile: this.profile });
    return { ok: true };
  }
  eraseAll() {
    for (const k of Object.values(KEYS)) this._del(k);
    this.profile = makeProfile();
    this.saveProfile(true);
    this.bus?.emit('save:erased', {});
  }
  storageBytes() {
    let total = 0;
    for (const k of Object.values(KEYS)) {
      const v = this._get(k);
      if (v) total += v.length + k.length;
    }
    return total;
  }
}

const MEDAL_RANK = { null: 0, bronze: 1, silver: 2, gold: 3 };
export function bestMedal(a, b) { return (MEDAL_RANK[b] ?? 0) > (MEDAL_RANK[a] ?? 0) ? b : a; }

export default SaveManager;
