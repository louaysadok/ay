/**
 * AudioManager.js — fully offline audio.
 *
 * Every sound is synthesised in code with the Web Audio API: no audio files to
 * download, no decoding cost, and the engine note tracks the actual machine
 * speed. The optional background bed is a slow, quiet procedural pad so it
 * never fights the machinery sounds.
 *
 * Browsers require a user gesture before audio can start, so `unlock()` is
 * called from the first click/keypress.
 */
export class AudioManager {
  constructor(bus, settings) {
    this.bus = bus;
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.nodes = {};
    this.enabled = true;
    this.lastPlayed = new Map();
    this.engine = null;
    this.music = null;
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._buildGraph();
      this.ready = true;
    } catch (e) {
      console.warn('[Audio] unavailable', e);
      this.enabled = false;
    }
    return this.ctx;
  }

  _buildGraph() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(master);

    const busFor = (name, gain) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(comp);
      return g;
    };
    this.nodes.master = master;
    this.nodes.sfx = busFor('sfx', 0.9);
    this.nodes.engine = busFor('engine', 0.6);
    this.nodes.warnings = busFor('warnings', 0.9);
    this.nodes.ui = busFor('ui', 0.7);
    this.nodes.music = busFor('music', 0.3);

    // shared noise buffer for tyres / hydraulics / sea
    const len = ctx.sampleRate * 1.6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = 0.98 * last + 0.02 * w;              // brown-ish noise
      d[i] = last * 3.2;
    }
    this.noiseBuffer = buf;
  }

  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.applySettings(true);
    return this.ctx;
  }

  applySettings(immediate = false) {
    if (!this.ready) return;
    const g = this.settings.audioGains();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const set = (node, v) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setTargetAtTime(v, t, immediate ? 0.01 : 0.12);
    };
    set(this.nodes.master, g.master);
    set(this.nodes.sfx, g.sfx);
    set(this.nodes.engine, g.engine);
    set(this.nodes.warnings, g.warnings);
    set(this.nodes.ui, g.ui);
    set(this.nodes.music, g.music);
    if (this.music) this.music.setVolume(g.music);
  }

  /* ---------------------------------------------------------------- helpers */
  _now() { return this.ctx.currentTime; }
  _guard(key, ms = 45) {
    const t = performance.now();
    const last = this.lastPlayed.get(key) || 0;
    if (t - last < ms) return false;
    this.lastPlayed.set(key, t);
    return true;
  }
  _noise(dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Simple percussive tone with an exponential decay envelope. */
  tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.3, bus = 'sfx', detune = 0, glide = null, attack = 0.005 }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = this._now();
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + dur);
    if (detune) osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(this.nodes[bus] || this.nodes.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst — mechanical clunks, tyres, hydraulics. */
  noise({ dur = 0.25, freq = 900, q = 1.2, gain = 0.25, bus = 'sfx', type = 'bandpass', slideTo = null }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = this._now();
    const src = this._noise(dur);
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (slideTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    filt.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(env); env.connect(this.nodes[bus] || this.nodes.sfx);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ------------------------------------------------------------ game sounds */
  ui(which = 'click') {
    if (!this._guard('ui' + which, 30)) return;
    switch (which) {
      case 'click': this.tone({ freq: 660, dur: 0.06, type: 'triangle', gain: 0.22, bus: 'ui' }); break;
      case 'back': this.tone({ freq: 420, dur: 0.07, type: 'triangle', gain: 0.2, bus: 'ui' }); break;
      case 'open': this.tone({ freq: 520, dur: 0.09, type: 'sine', gain: 0.2, bus: 'ui', glide: 780 }); break;
      case 'error': this.tone({ freq: 220, dur: 0.16, type: 'square', gain: 0.14, bus: 'ui' }); break;
      case 'toggle': this.tone({ freq: 840, dur: 0.05, type: 'square', gain: 0.14, bus: 'ui' }); break;
      case 'tick': this.tone({ freq: 1180, dur: 0.03, type: 'sine', gain: 0.12, bus: 'ui' }); break;
    }
  }

  horn() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this._now();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.03);
    g.gain.setValueAtTime(0.34, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    g.connect(this.nodes.warnings);
    for (const f of [240, 302]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800;
      o.connect(lp); lp.connect(g);
      o.start(t); o.stop(t + 0.66);
    }
  }

  reverseBeep() {
    if (!this._guard('rev', 620)) return;
    this.tone({ freq: 1180, dur: 0.13, type: 'square', gain: 0.16, bus: 'warnings' });
    setTimeout(() => this.tone({ freq: 1180, dur: 0.13, type: 'square', gain: 0.13, bus: 'warnings' }), 190);
  }

  hydraulic(dir = 1) {
    if (!this._guard('hyd', 180)) return;
    this.noise({ dur: 0.34, freq: dir > 0 ? 520 : 700, slideTo: dir > 0 ? 880 : 380, q: 2.4, gain: 0.2, type: 'bandpass' });
    this.tone({ freq: dir > 0 ? 140 : 118, dur: 0.3, type: 'sawtooth', gain: 0.05, bus: 'sfx' });
  }

  /** Twisting locks / pins engaging. */
  latch() {
    this.noise({ dur: 0.16, freq: 2400, q: 3.2, gain: 0.24, type: 'highpass' });
    this.tone({ freq: 190, dur: 0.1, type: 'square', gain: 0.12 });
  }
  /** Steel-on-steel impact, scaled by severity. */
  impact(severity = 0.4) {
    const g = Math.min(0.55, 0.16 + severity * 0.4);
    this.noise({ dur: 0.42, freq: 320, slideTo: 90, q: 0.9, gain: g, type: 'lowpass' });
    this.tone({ freq: 90, dur: 0.32, type: 'square', gain: g * 0.5 });
  }
  containerSettle() {
    this.noise({ dur: 0.5, freq: 180, slideTo: 60, q: 0.7, gain: 0.32, type: 'lowpass' });
    this.tone({ freq: 74, dur: 0.36, type: 'sine', gain: 0.16 });
  }
  success() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.2, bus: 'sfx' }), i * 105));
  }
  failure() {
    [330, 262, 196].forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 0.42, type: 'sine', gain: 0.18, bus: 'sfx' }), i * 170));
  }
  medal(tier = 'gold') {
    const sets = { gold: [784, 988, 1175, 1568], silver: [698, 880, 1046], bronze: [523, 659, 784] };
    (sets[tier] || sets.bronze).forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 0.6, type: 'triangle', gain: 0.2 }), i * 120));
  }
  /** Short rising triad when a new machine or feature is unlocked. */
  unlockJingle() {
    [523, 784, 1046].forEach((f, i) => setTimeout(() => this.tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.2 }), i * 90));
  }

  /**
   * Name-based dispatcher so UI code can stay decoupled:
   * play('ui_click') / play('horn') / play('medal', 'gold').
   */
  play(name, arg) {
    const map = {
      ui: 'ui', ui_click: 'ui', ui_open: 'ui', ui_close: 'ui', ui_back: 'ui',
      horn: 'horn', reverse: 'reverseBeep', hydraulic: 'hydraulic', latch: 'latch',
      impact: 'impact', bump: 'impact', settle: 'containerSettle', containerSettle: 'containerSettle',
      success: 'success', failure: 'failure', medal: 'medal', unlock: 'unlockJingle', tick: 'clockTick'
    };
    const fn = map[name] || name;
    const method = this[fn];
    if (typeof method !== 'function') return;
    try { method.call(this, arg); } catch (e) { /* audio must never break gameplay */ }
  }
  clockTick() { this.tone({ freq: 1500, dur: 0.04, type: 'sine', gain: 0.1, bus: 'ui' }); }

  /* -------------------------------------------------------- engine + music */
  startEngine(vehicle) {
    if (!this.ready || this.engine) return;
    const ctx = this.ctx;
    const t = this._now();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.nodes.engine);
    // two detuned saws + a low rumble noise, filtered
    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 58;
    const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 87;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3.2;
    const rumble = this._noise(1.6);
    const rGain = ctx.createGain(); rGain.gain.value = 0.5;
    const rFilter = ctx.createBiquadFilter(); rFilter.type = 'lowpass'; rFilter.frequency.value = 160;
    osc1.connect(lp); osc2.connect(lp); lp.connect(g);
    rumble.connect(rFilter); rFilter.connect(rGain); rGain.connect(g);
    osc1.start(t); osc2.start(t); rumble.start(t);
    this.engine = { osc1, osc2, lp, g, rumble, base: 58 };
    g.gain.setTargetAtTime(0.16, t, 0.3);
  }
  stopEngine() {
    if (!this.engine) return;
    const t = this._now();
    const e = this.engine;
    e.g.gain.setTargetAtTime(0.0001, t, 0.15);
    e.osc1.stop(t + 0.5); e.osc2.stop(t + 0.5); e.rumble.stop(t + 0.5);
    this.engine = null;
  }
  /** Called every simulation step with the player's machine state. */
  updateEngine(vehicle, dt) {
    if (!this.engine || !vehicle) return;
    const e = this.engine;
    const load = vehicle.engineLoad ?? Math.min(1, Math.abs(vehicle.speed) / (vehicle.spec.maxSpeed || 4));
    const t = this._now();
    const rpm = 0.55 + load * 0.85 + (vehicle.speed < -0.1 ? 0.12 : 0);
    e.osc1.frequency.setTargetAtTime(e.base * rpm, t, 0.14);
    e.osc2.frequency.setTargetAtTime(e.base * 1.5 * rpm, t, 0.14);
    e.lp.frequency.setTargetAtTime(320 + load * 700, t, 0.18);
    e.g.gain.setTargetAtTime(0.09 + load * 0.12, t, 0.2);
  }

  startMusic() {
    if (!this.ready || this.music) return;
    const ctx = this.ctx;
    const t = this._now();
    const out = ctx.createGain();
    out.gain.value = 0.0;
    out.connect(this.nodes.music);
    const voices = [];
    // slow, spacious pad: Dm-ish drone with gentle movement
    const freqs = [73.42, 110, 146.83, 220.0];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f * (1 + (i % 2 ? 0.004 : -0.003));
      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.045 + i * 0.017;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.05;
      lfo.connect(lfoGain); lfoGain.connect(g.gain);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(g); g.connect(lp); lp.connect(out);
      o.start(t); lfo.start(t);
      voices.push({ o, lfo, g });
    });
    out.gain.setTargetAtTime(0.22, t, 3.5);
    this.music = { out, voices };
  }
  stopMusic() {
    if (!this.music) return;
    const t = this._now();
    this.music.out.gain.setTargetAtTime(0.0001, t, 1.2);
    const m = this.music;
    setTimeout(() => { m.voices.forEach((v) => { try { v.o.stop(); v.lfo.stop(); } catch { /* already stopped */ } }); }, 2600);
    this.music = null;
  }
  setMusicVolume(v) { if (this.music) this.music.out.gain.setTargetAtTime(v * 0.6, this._now(), 0.6); }

  /** Wire the manager to the game event bus. */
  hook(bus) {
    bus.on('machine:horn', () => this.horn());
    bus.on('machine:hydraulics', (p) => this.hydraulic(p.axis === 'fork' ? 1 : 1));
    bus.on('machine:spreader', () => { this.latch(); });
    bus.on('machine:impact', (p) => this.impact(p.severity ?? 0.4));
    bus.on('cargo:lifted', () => this.latch());
    bus.on('cargo:placed', () => this.containerSettle());
    bus.on('cargo:rejected', () => this.ui('error'));
    bus.on('mission:complete', () => this.success());
    bus.on('mission:failed', () => this.failure());
    bus.on('progression:unlocked', () => this.unlockJingle());
    bus.on('progression:achievement', () => this.unlockJingle());
    bus.on('ui:click', () => this.ui('click'));
    bus.on('ui:back', () => this.ui('back'));
    bus.on('ui:open', () => this.ui('open'));
    bus.on('ui:toggle', () => this.ui('toggle'));
    bus.on('settings:changed', (p) => { if (p.key === '*' || ['master', 'music', 'sfx', 'muted', 'engineVolume', 'warnings', 'uiVolume'].includes(p.key)) this.applySettings(); });
  }
}

export default AudioManager;
