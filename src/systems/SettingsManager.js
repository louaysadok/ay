/**
 * SettingsManager.js — user options, persisted through SaveManager.
 * Applying a setting emits `settings:changed` so audio, renderer, HUD and
 * input can react without querying anything.
 */
import { DEFAULT_BINDINGS, BINDING_ORDER } from '../engine/InputManager.js';

export const DEFAULTS = {
  language: 'en',
  // audio
  master: 0.85, music: 0.35, sfx: 0.9, engineVolume: 0.65, warnings: 0.9, uiVolume: 0.7,
  muted: false,
  // graphics
  quality: 'high',         // high | medium | low
  fpsCap: 0,               // 0 = auto, otherwise 30/60
  cameraShake: true,
  vignette: true,
  zoomSmooth: true,
  showZones: false,
  showMarkers: true,
  showMinimap: true,
  // interface
  hudScale: 1,
  touchControls: 'auto',   // auto | on | off
  showHints: true,
  showPrompts: true,
  invertZoom: false,
  leftHanded: false,
  // gameplay
  tutorialHints: true,
  assist: 'normal',        // easy | normal | hard
  autosave: true,
  mentorNudges: true,
  // input
  bindings: null
};

export class SettingsManager {
  constructor(save, bus) {
    this.save = save;
    this.bus = bus;
    this.values = { ...DEFAULTS, ...save.loadSettings(DEFAULTS) };
    if (!this.values.bindings) this.values.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    // make sure every bindable action exists
    for (const a of BINDING_ORDER) if (!this.values.bindings[a]) this.values.bindings[a] = [...DEFAULT_BINDINGS[a]];
  }

  get(key) { return this.values[key]; }
  set(key, value, { silent = false } = {}) {
    if (this.values[key] === value) return value;
    const old = this.values[key];
    this.values[key] = value;
    this.save.saveSettings(this.values);
    if (!silent) this.bus?.emit('settings:changed', { key, value, old });
    return value;
  }
  setMany(patch, opts) {
    for (const [k, v] of Object.entries(patch)) this.set(k, v, { silent: true, ...opts });
    this.save.saveSettings(this.values);
    this.bus?.emit('settings:changed', { key: '*', value: this.values });
  }
  toggle(key) { return this.set(key, !this.values[key]); }
  resetDefaults() {
    const bindings = this.values.bindings;
    this.values = { ...DEFAULTS, bindings };
    this.save.saveSettings(this.values);
    this.bus?.emit('settings:changed', { key: '*', value: this.values });
  }
  resetBindings() {
    this.values.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    this.save.saveSettings(this.values);
    this.bus?.emit('settings:changed', { key: 'bindings', value: this.values.bindings });
  }
  setBinding(action, codes) {
    this.values.bindings[action] = [...codes];
    this.save.saveSettings(this.values);
    this.bus?.emit('settings:changed', { key: 'bindings', value: this.values.bindings });
  }

  /** Effective audio gains after the mute switch and master fader. */
  audioGains() {
    const v = this.values;
    if (v.muted) return { master: 0, music: 0, sfx: 0, engine: 0, warnings: 0, ui: 0 };
    return {
      master: v.master,
      music: v.music * v.master,
      sfx: v.sfx * v.master,
      engine: v.engineVolume * v.master,
      warnings: v.warnings * v.master,
      ui: v.uiVolume * v.master
    };
  }
  /** Difficulty multiplier applied by the scoring system. */
  assistFactor() {
    return this.values.assist === 'easy' ? 0.6 : this.values.assist === 'hard' ? 1.5 : 1;
  }
  timeFactor() {
    return this.values.assist === 'easy' ? 1.35 : this.values.assist === 'hard' ? 0.85 : 1;
  }
}

export default SettingsManager;
