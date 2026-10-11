/**
 * HUD.js — the in-game head-up display.
 *
 * Layout follows index.html + styles/game.css:
 *   top-left   mission card (mode, name, current objective, progress, timer)
 *   top-right  stats and icon buttons
 *   bottom-L   control legend for the machine in the cab
 *   bottom-C   action prompt and hints
 *   bottom-R   machine panel (load, capacity, condition, state) + machine strip
 *   floating   minimap
 *
 * Everything is data-driven from the machine spec and the mission so the HUD
 * never needs hand-tuning when content changes.
 */
import { clamp, fmtTime, fmtNum } from '../engine/Utils.js';
import { SpriteFactory as SF } from '../render/SpriteFactory.js';
import { mountIcons, iconDataUri } from './Icons.js';

export class HUD {
  constructor({ root, bus, i18n, settings, terminal, save, missions, mentor, audio, machineSpecs }) {
    this.root = root || document.getElementById('hud');
    this.bus = bus;
    this.i18n = i18n;
    this.settings = settings;
    this.terminal = terminal;
    this.save = save;
    this.missions = missions;
    this.mentor = mentor;
    this.audio = audio;
    this.machineSpecs = machineSpecs || {};

    this.el = {
      mode: document.getElementById('hud-mode'),
      mission: document.getElementById('hud-mission'),
      name: document.getElementById('hud-mission-name'),
      objective: document.getElementById('hud-objective'),
      progress: document.getElementById('hud-progress'),
      step: document.getElementById('hud-step'),
      timer: document.getElementById('hud-timer'),
      credits: document.getElementById('hud-credits'),
      level: document.getElementById('hud-level'),
      xp: document.getElementById('hud-xp'),
      alert: document.getElementById('hud-alert'),
      alertCount: document.getElementById('hud-alert-count'),
      controls: document.getElementById('hud-controls'),
      prompt: document.getElementById('action-prompt'),
      promptKey: document.getElementById('action-key'),
      promptText: document.getElementById('action-text'),
      hint: document.getElementById('hint-strip'),
      machines: document.getElementById('hud-machines'),
      minimap: document.getElementById('hud-minimap'),
      miniCanvas: document.getElementById('minimap'),
      nudge: document.getElementById('mentor-nudge'),
      nudgeOpen: document.getElementById('mentor-nudge-open'),
      pause: document.getElementById('hud-pause'),
      mentorBtn: document.getElementById('hud-mentor'),
      mapBtn: document.getElementById('hud-map'),
      soundBtn: document.getElementById('hud-sound'),
      helpBtn: document.getElementById('hud-help')
    };
    this.alertFlash = 0;
    this.visible = false;
    this.machines = [];
    this.currentMachine = null;
    this.miniScale = 1;
    this.panel = null;          // cached machine panel parts
    this._lastPrompt = '';
    this._lastObjective = '';
    this._legendMachine = null;
    this._setupMinimap();
  }

  /* ------------------------------------------------------------------ wiring */
  mount() {
    this.el.pause?.addEventListener('click', () => this.bus.emit('ui:action', { action: 'pause' }));
    this.el.mentorBtn?.addEventListener('click', () => this.bus.emit('ui:action', { action: 'mentor' }));
    this.el.nudgeOpen?.addEventListener('click', () => this.bus.emit('ui:action', { action: 'mentor' }));
    this.el.mapBtn?.addEventListener('click', () => this.toggleMinimap());
    this.el.soundBtn?.addEventListener('click', () => {
      const muted = !this.settings.get('muted');
      this.settings.set('muted', muted);
      this.bus.emit('toast', { text: this.i18n.t(muted ? 'common.off' : 'common.on'), icon: muted ? 'mute' : 'sound' });
    });
    this.el.helpBtn?.addEventListener('click', () => this.bus.emit('ui:action', { action: 'codex' }));
    this.bus.on('machine:impact', () => this.flashAlert());
    this.bus.on('safety:event', () => this.flashAlert());
    this.bus.on('settings:changed', (p) => { if (!p?.key || p.key === 'muted' || p.key === '*') this.syncSoundIcon(); });
    this.bus.on('player:machine', () => { this._legendMachine = null; this.panel = null; });
    this.syncSoundIcon();
    this.buildMachinePanel();
  }

  syncSoundIcon() {
    const ico = this.el.soundBtn?.querySelector('.ico');
    if (!ico) return;
    const name = this.settings.get('muted') ? 'mute' : 'sound';
    ico.setAttribute('data-icon', name);
    const uri = iconDataUri(name);
    ico.style.webkitMaskImage = uri; ico.style.maskImage = uri;
    ico.style.webkitMaskSize = 'contain'; ico.style.maskSize = 'contain';
    ico.style.webkitMaskRepeat = 'no-repeat'; ico.style.maskRepeat = 'no-repeat';
    ico.style.webkitMaskPosition = 'center'; ico.style.maskPosition = 'center';
  }

  /** Called by Game when a job starts or ends. */
  setMission(m) {
    this.mission = m || null;
    const card = this.el.mission;
    if (!m) { card?.classList.add('is-empty'); return; }
    card?.classList.remove('is-empty');
    card?.classList.add('pulse');
    setTimeout(() => card?.classList.remove('pulse'), 2500);
    const mode = m.mode || 'career';
    if (this.el.mode) {
      this.el.mode.textContent = this.i18n.t(`mode.${mode}`);
      this.el.mode.dataset.mode = mode;
    }
    if (this.el.name) this.el.name.textContent = m.title || m.name || m.id;
    this._lastObjective = '';
    this._lastPrompt = '';
  }

  show(v = true) {
    this.visible = v;
    this.root?.classList.toggle('is-hidden', !v);
  }

  /* ------------------------------------------------------- machine switching */
  setMachines(list, current) {
    this.machines = list || [];
    this.currentMachine = current;
    this.renderMachineStrip();
  }

  renderMachineStrip() {
    const strip = this.panel?.strip;
    if (!strip) return;
    strip.innerHTML = '';
    if (this.machines.length < 2) { strip.classList.add('is-hidden'); return; }
    strip.classList.remove('is-hidden');
    for (const id of this.machines) {
      const spec = this.machineSpecs[id];
      const b = document.createElement('button');
      b.className = 'ms' + (id === this.currentMachine ? ' active' : '');
      b.textContent = (spec?.short || id).slice(0, 3).toUpperCase();
      b.title = spec?.name || id;
      b.addEventListener('click', () => this.bus.emit('ui:action', { action: 'machine', machine: id }));
      strip.appendChild(b);
    }
  }

  buildMachinePanel() {
    const host = this.el.machines;
    if (!host) return;
    host.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'machine-panel';
    panel.innerHTML = `
      <div class="mp-head">
        <div class="mp-icon"></div>
        <div class="mp-names"><b></b><span></span></div>
        <div class="mp-throttle"><canvas class="mp-gauge" width="80" height="52"></canvas></div>
      </div>
      <div class="mp-body">
        <canvas class="mp-svg" width="208" height="112"></canvas>
        <div class="mp-facts">
          <div class="mp-fact"><span data-k="load"></span><b data-v="load">—</b></div>
          <div class="mp-fact"><span data-k="cap"></span><b data-v="cap">—</b></div>
          <div class="mp-fact"><span data-k="attach"></span><b data-v="attach">—</b></div>
        </div>
      </div>
      <div class="mp-bar load"><i></i></div>
      <div class="mp-bar hp"><i></i></div>
      <div class="mp-tags"></div>
      <div class="mp-machine-strip"></div>`;
    host.appendChild(panel);
    this.panel = {
      root: panel,
      icon: panel.querySelector('.mp-icon'),
      name: panel.querySelector('.mp-names b'),
      sub: panel.querySelector('.mp-names span'),
      gauge: panel.querySelector('.mp-gauge'),
      gaugeCtx: panel.querySelector('.mp-gauge').getContext('2d'),
      svg: panel.querySelector('.mp-svg'),
      svgCtx: panel.querySelector('.mp-svg').getContext('2d'),
      loadBar: panel.querySelector('.mp-bar.load'),
      loadFill: panel.querySelector('.mp-bar.load i'),
      hpBar: panel.querySelector('.mp-bar.hp'),
      hpFill: panel.querySelector('.mp-bar.hp i'),
      tags: panel.querySelector('.mp-tags'),
      strip: panel.querySelector('.mp-machine-strip')
    };
    this.refreshPanelLabels();
  }

  /** Panel labels follow the active language. */
  refreshPanelLabels() {
    const P = this.panel;
    if (!P) return;
    P.root.querySelector('[data-k="load"]').textContent = this.i18n.t('common.cargo');
    P.root.querySelector('[data-k="cap"]').textContent = this.i18n.t('toast.capacity');
    P.root.querySelector('[data-k="attach"]').textContent = this.i18n.t('hud.attachment');
    this._labelLang = this.i18n.lang;
  }

  /* ------------------------------------------------------------ control legend */
  renderControls(vehicle) {
    const host = this.el.controls;
    if (!host) return;
    host.innerHTML = '';
    const bindings = this.settings.get('bindings') || {};
    for (const c of (vehicle.spec.controls || []).slice(0, 7)) {
      const row = document.createElement('div');
      row.className = 'ctl-row';
      const kbd = document.createElement('kbd');
      kbd.textContent = this.keyLabel(c.action, bindings);
      const name = document.createElement('span');
      name.className = 'ctl-name';
      name.textContent = c.label;
      row.appendChild(kbd);
      row.appendChild(name);
      host.appendChild(row);
    }
  }

  keyLabel(action, bind = null) {
    const b = bind || this.settings.get('bindings') || {};
    const codes = b[action] || [];
    return codes.length ? codes.map(pretty).join('/') : '—';
    function pretty(code) {
      return String(code)
        .replace('Key', '').replace('Digit', '').replace('Numpad', '')
        .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
        .replace('Space', 'SPC').replace('ShiftLeft', 'SHIFT').replace('BracketLeft', '[').replace('BracketRight', ']');
    }
  }

  /* ---------------------------------------------------------------- updates */
  update(dt, ctx) {
    if (!this.visible) return;
    this.alertFlash = Math.max(0, this.alertFlash - dt);
    this.el.alert?.classList.toggle('flash', this.alertFlash > 0.05);

    const m = this.mission || this.missions.active;
    const vehicle = ctx.vehicle;

    /* --- mission card --------------------------------------------------- */
    if (m) {
      const p = this.missions.progressText();
      if (p.currentLabel && p.currentLabel !== this._lastObjective) {
        this._lastObjective = p.currentLabel;
        if (this.el.objective) this.el.objective.textContent = p.currentLabel;
      }
      if (this.el.progress) this.el.progress.style.width = `${Math.round(p.ratio * 100)}%`;
      if (this.el.step) this.el.step.textContent = `${this.i18n.t('common.progress')} ${p.done}/${p.total}`;
      if (this.el.timer) {
        this.el.timer.textContent = p.time || '--:--';
        this.el.timer.classList.toggle('urgent', !!p.urgent);
      }
      this.el.mission?.classList.toggle('urgent', !!p.urgent);
    } else {
      if (this.el.objective && this.el.objective.textContent !== this.i18n.t('hud.noMission')) {
        this.el.objective.textContent = this.i18n.t('hud.noMission');
      }
      if (this.el.progress) this.el.progress.style.width = '0%';
      if (this.el.step) this.el.step.textContent = '—';
      if (this.el.timer) this.el.timer.textContent = '--:--';
    }

    /* --- stats ---------------------------------------------------------- */
    const prof = this.save.profile;
    if (this.el.credits) this.el.credits.textContent = fmtNum(prof.credits);
    if (this.el.level) this.el.level.textContent = prof.level;
    const xp = this.save.xpProgress(prof.xp);
    if (this.el.xp) this.el.xp.style.width = `${Math.round(xp.ratio * 100)}%`;
    if (this.el.alertCount) this.el.alertCount.textContent = m ? m.safetyEvents : 0;

    /* --- machine panel -------------------------------------------------- */
    if (vehicle) {
      if (vehicle.type !== this._legendMachine) {
        this._legendMachine = vehicle.type;
        this.renderControls(vehicle);
        this.panel = null;
        this.buildMachinePanel();
        this.renderMachineStrip();
      }
      this.updateMachinePanel(vehicle);
    }

    this.updatePrompt(ctx);
    this.updateHint(m);
    this.drawMinimap(ctx);
  }

  updateMachinePanel(v) {
    const P = this.panel;
    if (!P) return;
    if (this._labelLang !== this.i18n.lang) this.refreshPanelLabels();
    const spec = v.spec;
    if (P.name.textContent !== (spec.name || v.type)) {
      P.name.textContent = spec.name || v.type;
      P.sub.textContent = `${spec.class || ''}${spec.capacityNote ? ' · ' + spec.capacityNote : ''}`;
      try {
        const spr = SF.machineThumb(v.type, 76, 60);
        P.icon.innerHTML = '';
        P.icon.appendChild(spr.canvas || spr);
      } catch (e) { /* thumbnails are decorative */ }
    }

    const load = v.load;
    const util = load ? clamp(load.weight / Math.max(0.1, spec.capacity), 0, 1.6) : 0;
    const facts = P.root.querySelectorAll('.mp-fact b');
    facts[0].textContent = load ? `${load.kind === 'container' ? load.size + "'" : ''} ${load.weight.toFixed(1)} t` : this.i18n.t('common.none');
    facts[1].textContent = `${spec.capacity} t`;
    facts[2].textContent = this.attachmentLabel(v);

    P.loadFill.style.width = `${Math.min(100, util * 100)}%`;
    P.loadBar.classList.toggle('near', util > 0.85 && util <= 1);
    P.loadBar.classList.toggle('over', util > 1);

    const hp = clamp((v.condition ?? 100) / 100, 0, 1);
    P.hpFill.style.width = `${hp * 100}%`;
    P.hpBar.classList.toggle('low', hp < 0.5);

    this.updateTags(v);
    this.drawGauge(v);
    this.drawSchematic(v);
  }

  attachmentLabel(v) {
    switch (v.type) {
      case 'forklift': return `Fork ${(v.forkHeight ?? 0).toFixed(1)} m`;
      case 'reachstacker': return `Boom ${(v.boomAngle ?? 0).toFixed(2)} rad · ${Math.round((v.boomExtend ?? 0) * 100)}% · ${v.spreaderSize}'`;
      case 'rtg': return `Trolley ${Math.round((v.trolleyPos ?? 0) * 100)}% · Hoist ${Math.round((v.hoistHeight ?? 0) * 100)}%`;
      case 'harborcrane': return `Radius ${v.radius?.toFixed(1) ?? '—'} m · ${v.currentCapacity?.().toFixed(0) ?? '—'} t`;
      case 'tractor': return v.coupled ? (v.trailerEmpty ? 'Trailer coupled' : 'Trailer loaded') : 'Uncoupled';
      default: return '—';
    }
  }

  updateTags(v) {
    const P = this.panel;
    if (!P) return;
    const tags = [];
    tags.push({ text: this.i18n.t('settings.engine'), on: v.engineOn });
    if (v.brakeOn) tags.push({ text: this.i18n.t('hud.brake'), on: true, cls: 'warn' });
    if (v.load) tags.push({ text: this.i18n.t('common.cargo'), on: true, cls: 'on' });
    if (v.type === 'rtg' && v.spreaderLow === false) tags.push({ text: 'Spreader high', on: false, cls: 'warn' });
    if (v.type === 'forklift' && (v.forkHeight ?? 0) > 1.5) tags.push({ text: 'Forks raised', on: false, cls: 'warn' });
    if (v.condition < 60) tags.push({ text: `${Math.round(v.condition)}%`, on: false, cls: 'bad' });
    const key = tags.map((t) => t.text + (t.on ? '1' : '0') + (t.cls || '')).join('|');
    if (P.tags.dataset.k === key) return;
    P.tags.dataset.k = key;
    P.tags.innerHTML = '';
    for (const t of tags) {
      const s = document.createElement('span');
      s.className = `mp-tag ${t.cls || (t.on ? 'on' : 'off')}`;
      s.textContent = t.text;
      P.tags.appendChild(s);
    }
  }

  /** Small speed gauge in the panel head. */
  drawGauge(v) {
    const P = this.panel;
    if (!P) return;
    const c = P.gaugeCtx;
    const w = P.gauge.width, h = P.gauge.height;
    const max = v.spec.maxSpeed || 4;
    const ratio = clamp(v.speed / max, -1, 1);
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h - 8, r = 30;
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
    const a = Math.PI * 1.5 + ratio * Math.PI * 0.48;
    c.strokeStyle = ratio < -0.02 ? '#ffc53d' : '#22c8b8';
    c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.5, a, ratio < 0); c.stroke();
    c.fillStyle = '#fff';
    c.font = '600 13px "SF Mono", ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText(`${Math.abs(v.speed).toFixed(1)}`, cx, cy - 8);
    c.fillStyle = 'rgba(219,230,239,.5)';
    c.font = '600 8px system-ui, sans-serif';
    c.fillText('m/s', cx, cy - 0.5);
  }

  /** Live top-view schematic of the machine with its attachment + load. */
  drawSchematic(v) {
    const P = this.panel;
    if (!P) return;
    const c = P.svgCtx;
    const w = P.svg.width, h = P.svg.height;
    c.clearRect(0, 0, w, h);
    try {
      const spr = SF.machineSprite(v.type);
      const src = spr.canvas;
      const scale = Math.min((w - 8) / src.width, (h - 8) / src.height);
      const dw = src.width * scale, dh = src.height * scale;
      c.save();
      c.translate(w / 2, h / 2);
      c.drawImage(src, -dw / 2, -dh / 2, dw, dh);
      // attachment + carried load drawn in the sprite frame, exactly like the world
      c.save();
      c.scale(scale, scale);
      c.translate(-src.width / 2 + spr.pad, -src.height / 2 + spr.pad);   // skip the sprite's padding
      const st = v.drawState ? v.drawState() : {};
      SF.drawAttachment(c, v.type, st, spr.ppu, { L: spr.l * spr.ppu, W: spr.w * spr.ppu });
      if (v.load) {
        c.globalAlpha = 0.9;
        c.fillStyle = v.load.kind === 'container' ? '#c8862f' : '#8a6a3c';
        const lw = v.load.length * spr.ppu, lh = v.load.width * spr.ppu;
        c.fillRect(-lw / 2 + (v.type === 'forklift' ? spr.ppu * 3.4 : 0), -lh / 2, lw, lh);
      }
      c.restore();
      c.restore();
    } catch (e) { /* schematic is decorative */ }
  }

  /* ---------------------------------------------------------------- prompt */
  updatePrompt(ctx) {
    const el = this.el.prompt;
    if (!el) return;
    const v = ctx.vehicle;
    if (!v || !this.settings.get('showPrompts')) { el.classList.add('is-hidden'); return; }
    let text = '';
    let blocked = false;
    if (this._promptOverride) {
      text = this._promptOverride;
    } else if (v.load) {
      const res = this.missions.attachments?.evaluatePlace?.(v);
      text = res?.ok ? this.i18n.t('hud.prompt.place') : (res?.message || this.i18n.t('hud.prompt.place'));
      blocked = !!res && !res.ok;
    } else if (ctx.liftTarget) {
      const res = this.missions.attachments?.evaluatePick?.(v);
      text = res?.ok ? this.i18n.t('hud.prompt.pick') : (res?.message || this.i18n.t('hud.prompt.pick'));
      blocked = !!res && !res.ok;
    } else if (v.type === 'tractor' && this.terminal.trailerAt?.(v.x, v.y, 5.5)) {
      text = this.i18n.t(v.coupled ? 'hud.prompt.uncouple' : 'hud.prompt.couple');
    }
    const key = this.keyLabel('interact');
    const sig = text + blocked;
    if (sig !== this._lastPrompt) {
      this._lastPrompt = sig;
      el.classList.toggle('is-hidden', !text);
      el.classList.toggle('blocked', blocked);
      if (this.el.promptKey) this.el.promptKey.textContent = key;
      if (this.el.promptText) this.el.promptText.textContent = text;
    }
  }

  setPromptOverride(text) { this._promptOverride = text || null; this._lastPrompt = '\u0000'; }

  updateHint(mission) {
    const host = this.el.hint;
    if (!host) return;
    if (!mission || !this.settings.get('showHints')) { host.innerHTML = ''; return; }
    const p = this.missions.progressText();
    const text = p.currentHint || '';
    if (host.dataset.k === text) return;
    host.dataset.k = text;
    host.innerHTML = '';
    if (!text) return;
    const chip = document.createElement('span');
    chip.className = 'hint-chip warn';
    chip.textContent = text;
    host.appendChild(chip);
  }

  flashAlert() { this.alertFlash = 1.6; }
  showNudge(v = true) { this.el.nudge?.classList.toggle('is-hidden', !v); }

  /* ---------------------------------------------------------------- minimap */
  setTerrain(terrain) { this.terrain = terrain; }

  _setupMinimap() {
    const c = this.el.miniCanvas;
    if (!c) return;
    this.miniCtx = c.getContext('2d');
    const w = this.terminal.bounds.w, h = this.terminal.bounds.h;
    this.miniScale = Math.min(c.width / w, c.height / h);
    this.miniW = w * this.miniScale;
    this.miniH = h * this.miniScale;
    const label = document.createElement('span');
    label.className = 'mm-label';
    label.setAttribute('data-i18n', 'hud.minimap');
    label.textContent = this.i18n.t('hud.minimap');
    this.el.minimap?.appendChild(label);
  }

  toggleMinimap() {
    const el = this.el.minimap;
    if (!el) return;
    const hidden = el.classList.toggle('collapsed');
    this.el.mapBtn?.setAttribute('aria-pressed', String(!hidden));
    this.bus.emit('ui:minimap', { visible: !hidden });
  }

  drawMinimap(ctx) {
    const c = this.miniCtx;
    if (!c || this.el.minimap?.classList.contains('collapsed')) return;
    const T = this.terminal;
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if (this.terrain?.mini) c.drawImage(this.terrain.mini, 0, 0, this.miniW, this.miniH);
    else { c.fillStyle = '#0a2033'; c.fillRect(0, 0, this.miniW, this.miniH); }
    const k = this.miniScale;
    for (const m of ctx.markers || []) {
      c.save();
      c.globalAlpha = 0.85;
      c.strokeStyle = m.color || '#22c8b8';
      c.lineWidth = 2;
      c.beginPath(); c.arc(m.x * k, m.y * k, 5, 0, Math.PI * 2); c.stroke();
      c.fillStyle = m.color || '#22c8b8';
      c.globalAlpha = 0.25;
      c.fill();
      c.restore();
    }
    for (const v of ctx.vehicles || []) {
      if (v === ctx.vehicle) continue;
      c.fillStyle = '#93beda';
      c.beginPath(); c.arc(v.x * k, v.y * k, 2.6, 0, Math.PI * 2); c.fill();
    }
    if (ctx.vehicle) {
      c.save();
      c.translate(ctx.vehicle.x * k, ctx.vehicle.y * k);
      c.rotate(ctx.vehicle.angle);
      c.fillStyle = '#22c8b8';
      c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, 4); c.lineTo(-4, -4); c.closePath(); c.fill();
      c.restore();
    }
    const cam = ctx.camera;
    if (cam) {
      const vr = cam.viewRect(0);
      c.strokeStyle = 'rgba(243,248,252,.5)';
      c.lineWidth = 1;
      c.strokeRect(vr.x * k, vr.y * k, vr.w * k, vr.h * k);
    }
  }
}

export default HUD;
