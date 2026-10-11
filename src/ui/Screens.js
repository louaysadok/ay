/**
 * Screens.js — every non-gameplay surface: boot, main menu, mission lists,
 * free-operations setup, settings, field manual and the modal overlays
 * (brief, pause, debrief, confirmations).
 *
 * The markup lives in index.html; this module fills the dynamic regions and
 * wires the data-action buttons, so there is never a dead button on screen.
 */
import { fmtNum, fmtTime, clamp } from '../engine/Utils.js';
import { SpriteFactory as SF } from '../render/SpriteFactory.js';
import { LANGUAGES } from '../systems/Localization.js';
import { mountIcons, iconEl, ICONS } from './Icons.js';

/** Animated 0..1 settings and their slider range. */
const RANGES = {
  master: [0, 1], music: [0, 1], sfx: [0, 1], engineVolume: [0, 1],
  warnings: [0, 1], uiVolume: [0, 1], hudScale: [0.8, 1.4]
};

const MODE_META = {
  career: { titleKey: 'mission.list.title.career', subKey: 'mission.list.sub.career', icon: 'route' },
  academy: { titleKey: 'mission.list.title.academy', subKey: 'mission.list.sub.academy', icon: 'cap' }
};

const SELF_ACTIONS = new Set(['continue', 'newgame', 'career', 'academy', 'free', 'settings', 'codex', 'back', 'exit']);

export class Screens {
  constructor(opts) {
    Object.assign(this, opts);           // i18n, settings, save, missions, mentor, progression, audio, bus, game, machines, lessons, career, saveManager
    this.current = 'boot';
    this.listMode = 'career';
    this.filter = 'all';
    this.freeSelection = { machine: 'forklift', shift: 'open' };
    this._wired = false;
  }

  /* ==================================================================== nav */
  showScreen(id) {
    this.current = id;
    document.querySelectorAll('#screens .screen').forEach((s) => {
      s.classList.toggle('show', s.id === `screen-${id}`);
    });
    const inGame = id === 'none';
    document.getElementById('screens')?.classList.toggle('is-hidden', inGame);
    if (id === 'menu') this.refreshMenu();
    if (id === 'list') this.renderLists();
    if (id === 'free') this.renderFree();
    if (id === 'settings') this.renderSettings();
    if (id === 'codex') this.renderCodex();
    this.bus?.emit('screen:shown', { id });
  }

  mount() {
    if (this._wired) return;
    this._wired = true;
    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => this.dispatch(el.dataset.action, el));
    });
    this.applyI18n();
  }

  dispatch(action, el) {
    this.audio?.play?.('ui_click');
    // Screens handles its own navigation below; re-emitting those would bounce
    // off main.js' router (which calls dispatch again) and recurse forever.
    if (!SELF_ACTIONS.has(action)) this.bus?.emit('ui:action', { action });
    switch (action) {
      case 'continue': return this.game.continueSession();
      case 'newgame': return this.confirmNewGame();
      case 'career': this.openList('career'); return;
      case 'academy': this.openList('academy'); return;
      case 'free': this.showScreen('free'); return;
      case 'settings': this.settingsReturn = this.current; this.showScreen('settings'); return;
      case 'codex': this.codexReturn = this.current; this.showScreen('codex'); return;
      case 'back': return this.goBack();
      case 'exit': return this.confirmExit();
      default:
        if (action?.startsWith('mission:')) return this.openBrief(action.slice(8));
    }
  }

  goBack() {
    if (this.current === 'settings' || this.current === 'codex') return this.showScreen(this.settingsReturn || this.codexReturn || 'menu');
    return this.showScreen('menu');
  }

  /** Re-render text nodes after a language change. */
  applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      const text = this.i18n.t(key);
      if (text && text !== key) el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const t = this.i18n.t(el.dataset.i18nTitle);
      if (t) el.title = t;
    });
    mountIcons();
    document.title = this.i18n.t('menu.subtitle') + ' — PORT OPS';
  }

  /* =================================================================== boot */
  bootProgress(p, statusKey, vars) {
    const bar = document.getElementById('boot-progress');
    if (bar) bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    const line = document.getElementById('boot-status');
    if (line) line.textContent = statusKey ? this.i18n.t(statusKey, vars) : this.i18n.t('boot.loading');
  }

  renderBootArt() {
    const logo = document.getElementById('boot-logo');
    if (logo && !logo.childElementCount) logo.appendChild(spriteNode(SF.brandMark()));
    const mark = document.getElementById('brand-mark');
    if (mark && !mark.childElementCount) mark.appendChild(spriteNode(SF.brandMark()));
    const tip = document.getElementById('boot-tip');
    if (tip) {
      const n = 1 + Math.floor(Math.random() * 5);
      tip.textContent = this.i18n.t(`boot.tip.${n}`);
    }
    const ver = document.getElementById('menu-version');
    if (ver) ver.textContent = 'v1.0 · offline';
  }

  /* =================================================================== menu */
  refreshMenu() {
    const p = this.save.profile;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('pc-level', p.level);
    set('pc-title', this.progression.title());
    set('pc-credits', fmtNum(p.credits));
    set('pc-medals', Object.values(p.stats.medals || {}).reduce((a, b) => a + b, 0));
    set('pc-time', `${Math.floor((p.playSeconds || 0) / 3600)}h`);
    const xp = this.save.xpProgress(p.xp);
    const xpBar = document.getElementById('pc-xp');
    if (xpBar) xpBar.style.width = `${Math.round(xp.ratio * 100)}%`;

    const cont = document.getElementById('continue-sub');
    const session = this.game.lastSessionSummary();
    if (cont) cont.textContent = session || this.i18n.t('menu.player.none');
    const contBtn = document.querySelector('[data-action="continue"]');
    if (contBtn) contBtn.classList.toggle('faded', !session);
  }

  confirmNewGame() {
    this.confirm({
      title: this.i18n.t('menu.newgame.confirm.title'),
      text: this.i18n.t('menu.newgame.confirm.text'),
      yes: this.i18n.t('menu.newgame.confirm.yes'),
      no: this.i18n.t('menu.newgame.confirm.no'),
      onYes: () => this.game.newGame()
    });
  }
  confirmExit() {
    this.confirm({
      title: this.i18n.t('menu.exit'),
      text: this.i18n.t('menu.exit.text'),
      yes: this.i18n.t('menu.exit.close'),
      no: this.i18n.t('menu.exit.back'),
      onYes: () => this.game.exitApp()
    });
  }

  /* ================================================================ missions */
  openList(mode) {
    this.listMode = mode;
    this.filter = 'all';
    this.showScreen('list');
  }

  defsFor(mode) {
    return mode === 'academy' ? (this.lessons?.lessons || []) : (this.career?.career?.missions || []);
  }
  chaptersFor(mode) {
    return mode === 'academy' ? (this.lessons?.chapters || []) : (this.career?.career?.chapters || []);
  }

  renderLists() {
    const mode = this.listMode;
    const meta = MODE_META[mode];
    const title = document.getElementById('list-title');
    const sub = document.getElementById('list-sub');
    if (title) title.textContent = this.i18n.t(meta.titleKey);
    if (sub) {
      const defs = this.defsFor(mode);
      const done = defs.filter((d) => this.save.profile.missions[d.id]?.completed).length;
      sub.textContent = `${this.i18n.t(meta.subKey)} · ${done}/${defs.length}`;
    }
    // right side: filters
    const right = document.getElementById('list-right');
    if (right) {
      right.innerHTML = '';
      for (const f of ['all', 'available', 'locked', 'done']) {
        const b = document.createElement('button');
        b.className = 'chip chip-btn' + (this.filter === f ? ' active' : '');
        b.textContent = this.i18n.t(`mission.filter.${f}`);
        b.addEventListener('click', () => { this.filter = f; this.renderLists(); });
        right.appendChild(b);
      }
    }
    // side: chapter progress
    const side = document.getElementById('list-side');
    if (side) {
      side.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'side-card';
      const h = document.createElement('h3');
      h.textContent = mode === 'academy' ? this.i18n.t('mission.lesson.progress') : this.i18n.t('career.progress');
      wrap.appendChild(h);
      for (const ch of this.chaptersFor(mode)) {
        const defs = this.defsFor(mode).filter((d) => d.chapter === ch.id);
        if (!defs.length) continue;
        const done = defs.filter((d) => this.save.profile.missions[d.id]?.completed).length;
        const row = document.createElement('div');
        row.className = 'chap-row';
        row.innerHTML = `<span class="chap-name"></span><span class="chap-count mono">${done}/${defs.length}</span>`;
        row.querySelector('.chap-name').textContent = ch.title;
        row.style.borderLeftColor = ch.color || 'var(--turq)';
        row.addEventListener('click', () => { this.scrollToChapter(ch.id); });
        wrap.appendChild(row);
        const bar = document.createElement('div');
        bar.className = 'chap-bar';
        const i = document.createElement('i');
        i.style.width = `${(done / defs.length) * 100}%`;
        bar.appendChild(i);
        wrap.appendChild(bar);
      }
      const ach = document.createElement('div');
      ach.className = 'side-card';
      const ah = document.createElement('h3');
      ah.textContent = this.i18n.t('achievement.title');
      ach.appendChild(ah);
      const list = document.createElement('div');
      list.className = 'ach-mini';
      for (const a of (this.career?.achievements || [])) {
        const got = !!this.save.profile.achievements[a.id];
        const row = document.createElement('div');
        row.className = 'ach-row' + (got ? ' got' : '');
        row.innerHTML = `<span class="ico" data-icon="${a.icon || 'medal'}"></span><span class="ach-name"></span>`;
        row.querySelector('.ach-name').textContent = a.name;
        row.title = a.desc;
        list.appendChild(row);
      }
      ach.appendChild(list);
      side.appendChild(ach);
    }
    this.renderCards();
  }

  renderCards() {
    const host = document.getElementById('list-cards');
    if (!host) return;
    host.innerHTML = '';
    const mode = this.listMode;
    const defs = this.defsFor(mode);
    let shown = 0;
    for (const ch of this.chaptersFor(mode)) {
      const chapterDefs = defs.filter((d) => d.chapter === ch.id && this._passesFilter(d));
      if (!chapterDefs.length) continue;
      const head = document.createElement('div');
      head.className = 'chap-head';
      head.id = `chap-${ch.id}`;
      head.textContent = ch.title;
      head.style.setProperty('--chap-color', ch.color || '#22c8b8');
      host.appendChild(head);
      for (const d of chapterDefs) { host.appendChild(this.missionCard(d, mode)); shown++; }
    }
    if (!shown) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = this.i18n.t('mission.filter.' + this.filter) + ' — 0';
      host.appendChild(empty);
    }
    mountIcons(host);
  }

  _passesFilter(d) {
    const rec = this.save.profile.missions[d.id];
    const available = this.progression.isAvailable(d);
    switch (this.filter) {
      case 'done': return !!rec?.completed;
      case 'locked': return !available;
      case 'available': return available && !rec?.completed;
      default: return true;
    }
  }

  missionCard(d, mode) {
    const rec = this.save.profile.missions[d.id];
    const available = this.progression.isAvailable(d);
    const medal = rec?.medal ? ' medal-' + rec.medal : '';
    const spec = this.machines[d.machine] || {};
    const card = document.createElement('article');
    card.className = `mcard ${kindClass(d)}` + (available ? '' : ' locked') + (rec?.completed ? ' done' : '');
    card.innerHTML = `
      <div class="mc-top">
        <div class="mc-thumb"></div>
        <div class="mc-titles">
          <span class="mc-mode-tag"></span>
          <h4></h4>
        </div>
      </div>
      <p class="mc-desc"></p>
      <div class="mc-req">
        <span class="tag"><span class="ico" data-icon="machines"></span><b data-f="machine"></b></span>
        <span class="tag"><span class="ico" data-icon="clock"></span><b data-f="time"></b></span>
        <span class="tag"><span class="ico" data-icon="star"></span><b data-f="reward"></b></span>
        <span data-f="state"></span>
      </div>
      <div class="mc-foot"></div>`;
    const thumb = card.querySelector('.mc-thumb');
    try {
      const spr = SF.machineThumb(d.machine, 96, 72);
      thumb.appendChild(spr.canvas || spr);
    } catch (e) { /* thumbnail is decorative */ }

    card.querySelector('.mc-mode-tag').textContent = this.i18n.t(mode === 'academy' ? 'mode.academy' : 'mode.career');
    card.querySelector('h4').textContent = d.title;
    card.querySelector('.mc-desc').textContent = d.subtitle || (d.brief || [])[0] || '';
    card.querySelector('[data-f="machine"]').textContent = spec.short || d.machine;
    card.querySelector('[data-f="time"]').textContent = d.timeLimit ? fmtTime(d.timeLimit) : this.i18n.t('mission.noLimit');
    card.querySelector('[data-f="reward"]').textContent = `${d.xp || 0} XP · ${d.credits || 0} cr`;

    const state = card.querySelector('[data-f="state"]');
    if (!available) {
      state.innerHTML = `<span class="tag lock"><span class="ico" data-icon="lock"></span>${this.i18n.t('common.locked')}</span>`;
      card.title = this.progression.lockReason(d)?.ids.map((id) => this.defName(id)).join(', ') || '';
    } else if (rec?.completed) {
      state.innerHTML = `<span class="tag${medal || ' ok'}"><span class="ico" data-icon="medal"></span>${rec.best ?? rec.score ?? 0}</span>`;
    } else {
      state.innerHTML = `<span class="tag ok">${this.i18n.t('mission.filter.available')}</span>`;
    }

    const actions = card.querySelector('.mc-foot');
    const openBtn = document.createElement('button');
    openBtn.className = 'btn' + (available ? '' : ' ghost');
    openBtn.textContent = available
      ? (rec?.completed ? this.i18n.t('common.replay') : this.i18n.t('common.viewbrief'))
      : this.i18n.t('common.locked');
    openBtn.addEventListener('click', () => {
      if (!available) {
        this.toastLock(d);
        return;
      }
      this.openBrief(d.id);
    });
    actions.appendChild(openBtn);
    if (rec?.completed && rec.breakdown) {
      const scoreBtn = document.createElement('button');
      scoreBtn.className = 'btn ghost small';
      scoreBtn.textContent = this.i18n.t('mission.score');
      scoreBtn.addEventListener('click', () => this.showScorecard(d, rec));
      actions.appendChild(scoreBtn);
    }
    return card;
  }

  toastLock(d) {
    const reason = this.progression.lockReason(d);
    this.bus?.emit('toast', {
      text: `${this.i18n.t('common.locked')} — ${this.i18n.t('common.requirement')}: ${reason?.ids.map((id) => this.defName(id)).join(', ') || '—'}`,
      icon: 'lock', tone: 'warn'
    });
  }

  defName(id) {
    const all = [...(this.lessons?.lessons || []), ...(this.career?.career?.missions || [])];
    return all.find((x) => x.id === id)?.title || id;
  }

  scrollToChapter(id) {
    document.getElementById(`chap-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ================================================================== brief */
  openBrief(id) {
    const all = [...(this.lessons?.lessons || []), ...(this.career?.career?.missions || [])];
    const d = all.find((x) => x.id === id);
    if (!d) return;
    const mode = d.id.startsWith('academy') ? 'academy' : 'career';
    const spec = this.machines[d.machine] || {};
    const goals = d.objectives || d.goals || [];
    const rows = goals.map((g) => `<li><span class="ico" data-icon="${iconForObjective(g)}"></span><span>${this.objectiveText(g)}</span></li>`).join('');
    const body = `
      <div class="ov-head">
        <span class="ico" data-icon="${mode === 'academy' ? 'cap' : 'route'}"></span>
        <div>
          <h2>${escapeHtml(d.title)}</h2>
          <p>${escapeHtml(d.subtitle || '')}</p>
        </div>
      </div>
      <div class="ov-body">
        <div class="ov-grid">
          <div class="brief-main">
            <h4>${this.i18n.t('mission.brief')}</h4>
            ${(d.brief || []).map((b) => `<p>${escapeHtml(b)}</p>`).join('')}
            <h4>${this.i18n.t('mission.objectives')}</h4>
            <ul class="ov-obj-list">${rows}</ul>
            ${(d.tips || []).length ? `<div class="note turq"><span class="ico" data-icon="mentor"></span><span>${escapeHtml(d.tips[0])}</span></div>` : ''}
          </div>
          <aside class="brief-side">
            <div class="side-stat"><span>${this.i18n.t('mission.requiredMachine')}</span><b>${escapeHtml(spec.name || d.machine)}</b></div>
            <div class="side-stat"><span>${this.i18n.t('mission.timeLimit')}</span><b>${d.timeLimit ? fmtTime(d.timeLimit) : this.i18n.t('mission.noLimit')}</b></div>
            <div class="side-stat"><span>${this.i18n.t('mission.reward')}</span><b>${d.xp || 0} XP · ${d.credits || 0} cr</b></div>
            ${d.unlocks ? `<div class="side-stat unlock"><span>${this.i18n.t('unlock.title')}</span><b>${escapeHtml((this.machines[d.unlocks] || {}).name || d.unlocks)}</b></div>` : ''}
            <p class="ov-note">${this.i18n.t('settings.note.offline')}</p>
          </aside>
        </div>
      </div>
      <div class="ov-foot">
        <button class="btn ghost" data-modal="close">${this.i18n.t('common.cancel')}</button>
        <button class="btn primary" data-modal="start"><span class="ico" data-icon="play"></span>${this.i18n.t(mode === 'academy' ? 'common.start' : 'mission.start')}</button>
      </div>`;
    this.overlay('brief', body, (root) => {
      root.querySelector('[data-modal="close"]').addEventListener('click', () => this.closeOverlay());
      root.querySelector('[data-modal="start"]').addEventListener('click', () => {
        this.closeOverlay();
        if (mode === 'academy') this.game.startLesson(d.id);
        else this.game.startCareer(d.id);
      });
    });
  }

  objectiveText(g) {
    const name = (spec) => {
      if (!spec) return '';
      const [, id] = String(spec).split(':');
      return id ? id.replace(/-/g, ' ') : spec;
    };
    switch (g.type) {
      case 'reach': return `${this.i18n.t('objective.drive')} ${name(g.target)}`;
      case 'park': return this.i18n.t('objective.park');
      case 'stop': return this.i18n.t('objective.move');
      case 'move': return `${this.i18n.t('objective.move')} ${g.distance} m`;
      case 'reverse': return `${this.i18n.t('objective.reverse')} ${g.distance} m`;
      case 'horn': return this.i18n.t('objective.horn');
      case 'cycle': return this.i18n.t('objective.inspect');
      case 'lift': case 'liftAny': return `${this.i18n.t('objective.lift')} ${g.count ?? 1} × ${g.cargo || ''}`;
      case 'liftId': return this.i18n.t('objective.retrieve');
      case 'liftFromBlock': return `${this.i18n.t('objective.retrieve')} (${g.block})`;
      case 'stack': return `${this.i18n.t('objective.stack')} (${g.block})`;
      case 'deliver': case 'place': return `${this.i18n.t('objective.deliver')} ${name(g.where)}`;
      case 'clean': return this.i18n.t('objective.zeroEvents');
      case 'damage': return this.i18n.t('objective.noDamage');
      case 'axis': {
        const up = g.op === '>' || g.op === '>=';
        return `${g.axis} ${up ? this.i18n.t('objective.raise') : this.i18n.t('objective.lower')}`;
      }
      default: return g.label || g.type;
    }
  }

  /* ================================================================== brief */
  renderFree() {
    const shifts = [
      { id: 'open', key: 'free.shift.open', descKey: 'free.shift.open.desc' },
      { id: 'yard', key: 'free.shift.yard', descKey: 'free.shift.yard.desc' },
      { id: 'practice', key: 'free.shift.practice', descKey: 'free.shift.practice.desc' }
    ];
    const host = document.getElementById('free-shifts');
    if (host) {
      host.innerHTML = '';
      for (const s of shifts) {
        const b = document.createElement('button');
        b.className = 'opt' + (this.freeSelection.shift === s.id ? ' active' : '');
        b.innerHTML = `<b></b><span></span>`;
        b.querySelector('b').textContent = this.i18n.t(s.key);
        b.querySelector('span').textContent = this.i18n.t(s.descKey);
        b.addEventListener('click', () => { this.freeSelection.shift = s.id; this.renderFree(); });
        host.appendChild(b);
      }
    }
    const grid = document.getElementById('free-machines');
    if (grid) {
      grid.innerHTML = '';
      for (const [id, spec] of Object.entries(this.machines)) {
        if (id === 'tractor') continue;
        const unlocked = this.progression.machineAvailable(id) || id === 'forklift';
        const card = document.createElement('button');
        card.className = 'mcard machine' + (this.freeSelection.machine === id ? ' active' : '') + (unlocked ? '' : ' locked');
        card.innerHTML = `
          <div class="mc-top">
            <div class="mc-thumb"></div>
            <div class="mc-titles">
              <span class="mc-mode-tag"></span>
              <h4></h4>
            </div>
          </div>
          <div class="mc-req">
            <span class="tag"><span class="ico" data-icon="machines"></span><b class="mcap"></b></span>
            ${unlocked ? '' : `<span class="tag lock"><span class="ico" data-icon="lock"></span>${this.i18n.t('common.locked')}</span>`}
          </div>`;
        const thumb = card.querySelector('.mc-thumb');
        try {
          const spr = SF.machineThumb(id, 96, 72);
          thumb.appendChild(spr.canvas || spr);
        } catch (e) { thumb.textContent = id; }
        card.querySelector('h4').textContent = spec.name;
        card.querySelector('.mc-mode-tag').textContent = spec.class;
        card.querySelector('.mcap').textContent = `${spec.capacity} t`;
        card.addEventListener('click', () => {
          if (!unlocked) {
            this.bus?.emit('toast', { text: `${this.i18n.t('common.locked')} — ${spec.unlockNote || ''}`, icon: 'lock', tone: 'warn' });
            return;
          }
          this.freeSelection.machine = id;
          this.renderFree();
        });
        grid.appendChild(card);
      }
    }
    const start = document.getElementById('free-start');
    if (start && !start._wired) {
      start._wired = true;
      start.addEventListener('click', () => this.game.startFree({
        machine: this.freeSelection.machine,
        shift: this.freeSelection.shift,
        jobs: document.getElementById('free-jobs')?.checked ?? true,
        traffic: document.getElementById('free-traffic')?.checked ?? true,
        safety: document.getElementById('free-safety')?.checked ?? true,
        overlays: document.getElementById('free-wide')?.checked ?? false
      }));
    }
  }

  /* =============================================================== settings */
  renderSettings() {
    const host = document.getElementById('settings-grid');
    if (!host) return;
    host.innerHTML = '';
    const groups = [
      { id: 'audio', keys: ['master', 'music', 'sfx', 'engineVolume', 'warnings', 'uiVolume', 'muted'] },
      { id: 'graphics', keys: ['quality', 'fpsCap', 'hudScale', 'cameraShake', 'vignette', 'showMinimap'] },
      { id: 'interface', keys: ['language', 'showHints', 'showPrompts', 'showZones', 'showMarkers', 'zoomSmooth'] },
      { id: 'controls', keys: ['touchControls', 'leftHanded', 'invertZoom', 'bindings'] },
      { id: 'gameplay', keys: ['assist', 'tutorialHints', 'mentorNudges', 'autosave'] },
      { id: 'data', keys: ['export', 'import', 'reset', 'storage'] }
    ];
    for (const g of groups) {
      const card = document.createElement('div');
      card.className = 'set-card';
      const h = document.createElement('h3');
      h.textContent = this.i18n.t(`settings.group.${g.id}`);
      card.appendChild(h);
      for (const key of g.keys) {
        const row = this.settingRow(key);
        if (row) card.appendChild(row);
      }
      host.appendChild(card);
    }
    mountIcons(host);
  }

  settingRow(key) {
    const val = this.settings.get(key);
    // the string table predates some setting names, so map explicitly
    const LABEL = {
      engineVolume: 'settings.engine', uiVolume: 'settings.ui', muted: 'settings.mute',
      fpsCap: 'settings.fps', cameraShake: 'settings.shake', touchControls: 'settings.touch',
      bindings: 'settings.keybindings', assist: 'settings.difficulty', tutorialHints: 'settings.tutorial'
    };
    const label = this.i18n.t(LABEL[key] || `settings.${key}`);
    const row = document.createElement('div');
    row.className = 'set-row';
    const lab = document.createElement('label');
    lab.className = 'sr-label';
    lab.textContent = label;
    lab.htmlFor = `set-${key}`;
    row.appendChild(lab);

    const control = document.createElement('div');
    control.className = 'sr-ctl';
    row.appendChild(control);

    // language
    if (key === 'language') {
      const sel = document.createElement('select');
      sel.id = `set-${key}`;
      for (const meta of LANGUAGES) {
        const o = document.createElement('option');
        o.value = meta.code;
        o.textContent = `${meta.flag || ''} ${meta.native || meta.name}`.trim();
        sel.appendChild(o);
      }
      sel.value = val;
      sel.addEventListener('change', async () => {
        await this.settings.set('language', sel.value);
        this.applyI18n();
        this.renderSettings();
      });
      control.appendChild(sel);
      return row;
    }
    if (key === 'export' || key === 'import') {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = this.i18n.t(`settings.${key}`);
      b.addEventListener('click', () => key === 'export' ? this.exportSave() : this.importSave());
      control.appendChild(b);
      return row;
    }
    if (key === 'reset') {
      const b = document.createElement('button');
      b.className = 'btn small danger';
      b.textContent = this.i18n.t('settings.reset');
      b.addEventListener('click', () => this.resetProgress());
      control.appendChild(b);
      return row;
    }
    if (key === 'storage') {
      const bytes = this.saveManager.storageBytes();
      const span = document.createElement('span');
      span.className = 'set-note mono';
      span.textContent = `${(bytes / 1024).toFixed(1)} KB`;
      control.appendChild(span);
      return row;
    }
    if (key === 'bindings') {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = this.i18n.t('settings.keybindings');
      b.addEventListener('click', () => this.openBindings());
      control.appendChild(b);
      const reset = document.createElement('button');
      reset.className = 'btn small ghost';
      reset.textContent = this.i18n.t('settings.defaults');
      reset.addEventListener('click', () => { this.settings.resetBindings(); this.toastSaved(); });
      control.appendChild(reset);
      return row;
    }

    const scalar = typeof val;
    if (scalar === 'boolean') {
      const sw = document.createElement('label');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `set-${key}`;
      input.checked = val;
      input.addEventListener('change', () => { this.settings.set(key, input.checked); this.toastSaved(); });
      sw.appendChild(input);
      const track = document.createElement('span');
      sw.appendChild(track);
      control.appendChild(sw);
      return row;
    }
    if (scalar === 'number') {
      const range = RANGES[key];
      if (range) {
        const meta = { min: range[0], max: range[1], step: 0.05 };
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.id = `set-${key}`;
        inp.min = meta.min; inp.max = meta.max;
        inp.step = meta.step ?? 0.05;
        inp.value = val;
        const out = document.createElement('b');
        out.className = 'mono';
        out.textContent = `${Math.round(val * 100)}%`;
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          out.textContent = `${Math.round(v * 100)}%`;
          this.settings.set(key, v);
        });
        inp.addEventListener('change', () => this.toastSaved());
        control.appendChild(inp);
        control.appendChild(out);
        return row;
      }
    }
    // enumerations
    const options = enumOptions(key);
    if (options) {
      const sel = document.createElement('select');
      sel.id = `set-${key}`;
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = this.i18n.t(o.key);
        sel.appendChild(opt);
      }
      sel.value = String(val);
      sel.addEventListener('change', () => {
        const raw = sel.value;
        const meta = options.find((o) => String(o.value) === raw);
        this.settings.set(key, meta?.value ?? raw);
        this.toastSaved();
      });
      control.appendChild(sel);
      return row;
    }
    const note = document.createElement('span');
    note.className = 'set-note';
    note.textContent = String(val);
    control.appendChild(note);
    return row;
  }

  openBindings() {
    const order = ['forward', 'reverse', 'left', 'right', 'auxUp', 'auxDown', 'auxLeft', 'auxRight', 'cycle', 'interact', 'brake', 'horn', 'recenter', 'zoomIn', 'zoomOut', 'map', 'mentor', 'pause'];
    const body = `
      <div class="ov-head"><span class="ico" data-icon="gear"></span><div><h2>${this.i18n.t('settings.keybindings')}</h2><p>${this.i18n.t('settings.clickToBind')}</p></div></div>
      <div class="ov-body"><div class="bind-grid"></div></div>
      <div class="ov-foot"><button class="btn ghost" data-modal="close">${this.i18n.t('common.close')}</button></div>`;
    this.overlay('bindings', body, (root) => {
      const grid = root.querySelector('.bind-grid');
      const bindings = this.settings.get('bindings') || {};
      for (const action of order) {
        const row = document.createElement('div');
        row.className = 'bind-row';
        row.innerHTML = `<span class="bind-label"></span><button class="btn small mono"></button>`;
        row.querySelector('.bind-label').textContent = this.i18n.t(`bind.${action}`) || action;
        const btn = row.querySelector('button');
        const paint = () => { btn.textContent = (bindings[action] || []).map(prettyKeyName).join(' / ') || '—'; };
        paint();
        btn.addEventListener('click', () => {
          btn.textContent = this.i18n.t('settings.clickToBind');
          btn.classList.add('listening');
          this.game.captureBinding(action, (code) => {
            btn.classList.remove('listening');
            if (code) {
              const map = { ...bindings };
              for (const k of Object.keys(map)) map[k] = (map[k] || []).filter((c) => c !== code);
              map[action] = [...(map[action] || []).filter((c, i, a) => a.indexOf(c) === i), code].slice(0, 2);
              this.settings.set('bindings', map);
              Object.assign(bindings, map);
              this.toastSaved();
            }
            paint();
          });
        });
        grid.appendChild(row);
      }
      root.querySelector('[data-modal="close"]').addEventListener('click', () => this.closeOverlay());
    });
  }

  exportSave() {
    try {
      const data = this.saveManager.exportAll();
      const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `portops-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.bus?.emit('toast', { text: this.i18n.t('settings.exported'), icon: 'check', tone: 'good' });
    } catch (e) {
      this.bus?.emit('toast', { text: this.i18n.t('settings.importFailed'), icon: 'warn', tone: 'bad' });
    }
  }

  importSave() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = this.saveManager.importAll(text);
        const ok = res === true || !!res?.ok;
        this.bus?.emit('toast', { text: this.i18n.t(ok ? 'settings.imported' : 'settings.importFailed'), icon: ok ? 'check' : 'warn', tone: ok ? 'good' : 'bad' });
        if (ok) { this.applyI18n(); this.refreshMenu(); }
      } catch (e) {
        this.bus?.emit('toast', { text: this.i18n.t('settings.importFailed'), icon: 'warn', tone: 'bad' });
      }
    });
    input.click();
  }

  resetProgress() {
    this.confirm({
      title: this.i18n.t('settings.reset.confirm'),
      text: this.i18n.t('settings.reset.text'),
      yes: this.i18n.t('common.yes'),
      no: this.i18n.t('common.no'),
      danger: true,
      onYes: () => {
        this.saveManager.eraseAll();
        this.game.reloadProfile();
        this.toastSaved();
        this.renderSettings();
      }
    });
  }

  toastSaved() { this.bus?.emit('toast', { key: 'toast.saved', icon: 'check', tone: 'muted', life: 1500 }); }

  /* ================================================================== codex */
  renderCodex() {
    const tabs = [
      { id: 'controls', icon: 'gear' },
      { id: 'machines', icon: 'machines' },
      { id: 'safety', icon: 'shield' },
      { id: 'glossary', icon: 'book' },
      { id: 'about', icon: 'help' }
    ];
    if (!this.codexTab) this.codexTab = 'controls';
    const host = document.getElementById('codex-tabs');
    if (host) {
      host.innerHTML = '';
      for (const t of tabs) {
        const b = document.createElement('button');
        b.className = 'opt' + (this.codexTab === t.id ? ' active' : '');
        b.innerHTML = `<span class="ico" data-icon="${t.icon}"></span><b></b>`;
        b.querySelector('b').textContent = this.i18n.t(`codex.tab.${t.id}`);
        b.addEventListener('click', () => { this.codexTab = t.id; this.renderCodex(); });
        host.appendChild(b);
      }
    }
    const body = document.getElementById('codex-body');
    if (!body) return;
    body.innerHTML = '';
    body.appendChild(this.codexSection(this.codexTab));
    mountIcons(body);
  }

  codexSection(id) {
    const wrap = document.createElement('div');
    wrap.className = 'codex-block';
    if (id === 'controls') {
      const bindings = this.settings.get('bindings') || {};
      const items = Object.entries(bindings).map(([action, codes]) => `
        <div class="kbd-item"><span>${escapeHtml(this.i18n.t(`bind.${action}`) || action)}</span>
          <b>${codes.map((c) => `<kbd>${escapeHtml(prettyKeyName(c))}</kbd>`).join('')}</b></div>`).join('');
      wrap.innerHTML = `
        <h3><span class="ico" data-icon="gear"></span>${this.i18n.t('codex.tab.controls')}</h3>
        <div class="kbd-grid">${items}</div>
        <div class="note"><span class="ico" data-icon="help"></span><span>${this.i18n.t('settings.note.offline')}</span></div>`;
      return wrap;
    }
    if (id === 'machines') {
      wrap.innerHTML = `<h3><span class="ico" data-icon="machines"></span>${this.i18n.t('codex.tab.machines')}</h3>`;
      for (const [mid, spec] of Object.entries(this.machines)) {
        if (mid === 'tractor') continue;
        const card = document.createElement('div');
        card.className = 'codex-mach';
        const thumb = document.createElement('div');
        thumb.className = 'codex-thumb';
        try { const t = SF.machineThumb(mid, 132, 92); thumb.appendChild(t.canvas || t); } catch (e) { /* optional */ }
        card.appendChild(thumb);
        const info = document.createElement('div');
        info.className = 'codex-mach-info';
        info.innerHTML = `
          <h4>${escapeHtml(spec.name)}</h4>
          <p class="cm-class">${escapeHtml(spec.class)}</p>
          <p>${escapeHtml(spec.description || '')}</p>
          <table class="spec-table">
            <tr><th>${this.i18n.t('hud.attachment')}</th><td><b>${escapeHtml(spec.attachment)}</b></td>
                <th>${this.i18n.t('toast.capacity')}</th><td><b>${spec.capacity} t</b></td></tr>
            <tr><th>${this.i18n.t('codex.dimensions')}</th><td><b>${spec.length} × ${spec.width} m</b></td>
                <th>${this.i18n.t('codex.speed')}</th><td><b>${(spec.maxSpeed * 3.6).toFixed(0)} km/h</b></td></tr>
            <tr><th>${this.i18n.t('codex.weight')}</th><td><b>${spec.mass} t</b></td>
                <th>${this.i18n.t('unlock.title')}</th><td><b>${spec.unlock ? this.i18n.t('common.unlocksLater') : this.i18n.t('common.starter')}</b></td></tr>
          </table>
          <p class="ov-note">${escapeHtml(spec.capacityNote || '')}</p>
          <ul class="cm-tips">${(spec.trainingTips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
        card.appendChild(info);
        wrap.appendChild(card);
      }
      return wrap;
    }
    if (id === 'safety') {
      const text = this.i18n.t('codex.safety');
      const blocks = String(text).split('|').map((x) => x.trim()).filter(Boolean);
      wrap.innerHTML = `<h3><span class="ico" data-icon="shield"></span>${this.i18n.t('codex.tab.safety')}</h3>`;
      if (!blocks.length || text === 'codex.safety') {
        wrap.innerHTML += `<p class="ov-note">${this.i18n.t('common.none')}</p>`;
      } else {
        const ul = document.createElement('ul');
        for (const b of blocks) { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); }
        wrap.appendChild(ul);
      }
      return wrap;
    }
    if (id === 'glossary') {
      const text = this.i18n.t('codex.glossary');
      const entries = String(text).split('|').map((x) => x.trim()).filter(Boolean);
      wrap.innerHTML = `<h3><span class="ico" data-icon="book"></span>${this.i18n.t('codex.tab.glossary')}</h3>`;
      const dl = document.createElement('dl');
      dl.className = 'gloss';
      for (const entry of entries) {
        const m = entry.split(/\s[—–-]\s|:\s/);
        const term = m.length > 1 ? m[0] : entry;
        const desc = m.length > 1 ? m.slice(1).join(' — ') : '';
        const dt = document.createElement('dt'); dt.textContent = term;
        const dd = document.createElement('dd'); dd.textContent = desc;
        dl.appendChild(dt); dl.appendChild(dd);
      }
      wrap.appendChild(dl);
      return wrap;
    }
    wrap.innerHTML = `
      <h3><span class="ico" data-icon="help"></span>${this.i18n.t('codex.tab.about')}</h3>
      <p>PORT OPS SIMULATOR — ${this.i18n.t('boot.tagline')}</p>
      <p>${this.i18n.t('menu.disclaimer')}</p>
      <p class="ov-note">${this.i18n.t('boot.footer')}</p>`;
    return wrap;
  }

  /* =============================================================== overlays */
  overlay(kind, bodyHtml, onMount) {
    const host = document.getElementById('overlays');
    if (!host) return null;
    host.classList.remove('is-hidden');
    host.innerHTML = '';
    const modal = document.createElement('div');
    modal.className = `ov-card ${kind}`;
    modal.innerHTML = bodyHtml;
    host.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('in'));
    mountIcons(modal);
    onMount?.(modal);
    this._overlay = modal;
    this._overlayEsc = (e) => { if (e.key === 'Escape') this.closeOverlay(); };
    window.addEventListener('keydown', this._overlayEsc);
    return modal;
  }

  closeOverlay() {
    const host = document.getElementById('overlays');
    const modal = this._overlay;
    if (this._overlayEsc) window.removeEventListener('keydown', this._overlayEsc);
    this._overlayEsc = null;
    this._overlay = null;
    if (!modal || !host) return;
    modal.classList.remove('in');
    setTimeout(() => { host.innerHTML = ''; host.classList.add('is-hidden'); }, 220);
    this.bus?.emit('overlay:closed', {});
  }
  get overlayOpen() { return !!this._overlay; }

  confirm({ title, text, yes, no, onYes, danger }) {
    const body = `
      <div class="ov-head"><span class="ico" data-icon="${danger ? 'warn' : 'help'}"></span><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text || '')}</p></div></div>
      <div class="ov-foot">
        <button class="btn ghost" data-modal="no">${escapeHtml(no || this.i18n.t('common.cancel'))}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-modal="yes">${escapeHtml(yes || this.i18n.t('common.yes'))}</button>
      </div>`;
    this.overlay('confirm', body, (root) => {
      root.querySelector('[data-modal="no"]').addEventListener('click', () => this.closeOverlay());
      root.querySelector('[data-modal="yes"]').addEventListener('click', () => { this.closeOverlay(); onYes?.(); });
    });
  }

  /* =================================================================== pause */
  openPause() {
    const controls = this.game.currentControls?.() || [];
    const rows = controls.map((c) => `<li><span class="key">${c.keys}</span><span>${escapeHtml(c.label)}</span></li>`).join('');
    const body = `
      <div class="ov-head"><span class="ico" data-icon="pause"></span><div><h2>${this.i18n.t('pause.title')}</h2><p>${this.i18n.t('common.paused')}</p></div></div>
      <div class="ov-body pause-body">
        <div class="pause-controls"><h4>${this.i18n.t('pause.controls')}</h4><ul class="ctl-list">${rows}</ul></div>
        <div class="pause-side">
          <div class="pause-audio"><h4>${this.i18n.t('pause.audio')}</h4>
            <label class="switch"><input type="checkbox" id="pause-music" ${this.settings.get('music') ? 'checked' : ''}><span></span><em>${this.i18n.t('settings.music')}</em></label>
            <label class="switch"><input type="checkbox" id="pause-mute" ${this.settings.get('muted') ? 'checked' : ''}><span></span><em>${this.i18n.t('settings.mute')}</em></label>
          </div>
        </div>
      </div>
      <div class="ov-foot">
        <button class="btn ghost" data-modal="menu">${this.i18n.t('pause.backToMenu')}</button>
        <button class="btn ghost" data-modal="restart">${this.i18n.t('common.restart')}</button>
        <button class="btn ghost" data-modal="settings"><span class="ico" data-icon="gear"></span>${this.i18n.t('menu.settings')}</button>
        <button class="btn primary" data-modal="resume">${this.i18n.t('common.resume')}</button>
      </div>`;
    this.overlay('pause', body, (root) => {
      root.querySelector('#pause-music').addEventListener('change', (e) => this.settings.set('music', e.target.checked));
      root.querySelector('#pause-mute').addEventListener('change', (e) => this.settings.set('muted', e.target.checked));
      root.querySelector('[data-modal="resume"]').addEventListener('click', () => { this.closeOverlay(); this.game.resume(); });
      root.querySelector('[data-modal="restart"]').addEventListener('click', () => { this.closeOverlay(); this.game.restart(); });
      root.querySelector('[data-modal="menu"]').addEventListener('click', () => { this.closeOverlay(); this.game.toMenu(); });
      root.querySelector('[data-modal="settings"]').addEventListener('click', () => {
        this.closeOverlay();
        this.settingsReturn = 'menu';
        this.game.pauseSettings();
        this.showScreen('settings');
      });
    });
  }

  /* ================================================================ debrief */
  showResult({ mission, result, rewards, unlocked, achievements, onNext, onRetry, nextLabel }) {
    const cats = result.categories || {};
    const rows = Object.entries(cats).map(([k, v]) => {
      const w = { safety: 35, accuracy: 25, equipment: 20, time: 10, efficiency: 10 }[k] || 0;
      const tone = v.value >= 85 ? 'good' : v.value >= 60 ? 'mid' : 'bad';
      return `<div class="score-row" data-cat="${k}">
        <span class="sr-name">${this.i18n.t('score.' + (k === 'equipment' ? 'equipment' : k))}<em>${w}%</em></span>
        <span class="score-bar ${tone}"><i style="width:${Math.round(v.value)}%"></i></span>
        <b class="mono">${Math.round(v.value)}</b>
      </div>`;
    }).join('');
    const medal = result.medal || null;
    const medalTag = medal ? `<em class="medal-badge medal-${medal}">${this.i18n.t('score.medal.' + medal)}</em>` : '';
    const body = `
      <div class="ov-head result ${mission.status === 'completed' ? '' : 'failed'} ${result.perfect ? 'perfect' : ''}">
        <span class="ico" data-icon="${mission.status === 'completed' ? 'medal' : 'x'}"></span>
        <div>
          <h2>${escapeHtml(mission.title)} — ${this.i18n.t(mission.status === 'completed' ? 'mission.complete' : 'mission.failed')}</h2>
          <p>${escapeHtml(result.summary || '')}</p>
        </div>
        <div class="result-total">
          <b class="mono">${result.score}</b>
          <span>${this.i18n.t('score.total')}</span>
          ${medal ? medalTag : `<em class="medal-badge none">${this.i18n.t('score.noMedal')}</em>`}
        </div>
      </div>
      <div class="ov-body">
          <div class="result-scores">
            <h4>${this.i18n.t('mission.feedback')}</h4>
            ${rows}
            ${result.perfect ? `<div class="perfect-band"><span class="ico" data-icon="shield"></span>${this.i18n.t('score.perfect')}</div>` : ''}
          </div>
          <div class="ov-grid reward-grid">
            <div class="ov-stat"><div class="osl">${this.i18n.t('score.xp')}</div><div class="osv">+${rewards?.xp || 0}</div></div>
            <div class="ov-stat"><div class="osl">${this.i18n.t('score.credits')}</div><div class="osv">+${rewards?.credits || 0}</div></div>
            ${rewards?.levelUp ? `<div class="ov-stat good"><div class="osl">${this.i18n.t('score.level')}</div><div class="osv">${rewards.level}</div><div class="osn">${this.i18n.t('toast.levelUp', { level: rewards.level })}</div></div>` : ''}
            ${unlocked?.length ? `<div class="ov-stat"><div class="osl">${this.i18n.t('unlock.title')}</div><div class="osv">${unlocked.length}</div><div class="osn">${unlocked.map((u) => escapeHtml((this.machines[u] || {}).name || u)).join(', ')}</div></div>` : ''}
            ${achievements?.length ? `<div class="ov-stat good"><div class="osl">${this.i18n.t('achievement.title')}</div><div class="osv">${achievements.length}</div><div class="osn">${achievements.map((a) => escapeHtml((this.career?.achievements || []).find((x) => x.id === a)?.name || a)).join(', ')}</div></div>` : ''}
            ${result.newBest ? `<div class="ov-stat good"><div class="osl">${this.i18n.t('mission.newBest')}</div><div class="osv">★</div></div>` : ''}
          </div>
      </div>
      <div class="ov-foot">
        ${onRetry ? `<button class="btn ghost" data-modal="retry"><span class="ico" data-icon="refresh"></span>${this.i18n.t('mission.retry')}</button>` : ''}
        <button class="btn ghost" data-modal="menu">${this.i18n.t('common.menu')}</button>
        ${onNext ? `<button class="btn primary" data-modal="next">${escapeHtml(nextLabel || this.i18n.t('mission.next'))}</button>` : ''}
      </div>`;
    this.overlay('result', body, (root) => {
      root.querySelector('[data-modal="menu"]').addEventListener('click', () => { this.closeOverlay(); this.game.toMenu(); });
      root.querySelector('[data-modal="retry"]')?.addEventListener('click', () => { this.closeOverlay(); onRetry(); });
      root.querySelector('[data-modal="next"]')?.addEventListener('click', () => { this.closeOverlay(); onNext(); });
    });
  }

  showScorecard(def, rec) {
    const b = rec.breakdown || {};
    const body = `
      <div class="ov-head"><span class="ico" data-icon="star"></span><div><h2>${escapeHtml(def.title)}</h2><p>${this.i18n.t('common.best')}: ${rec.best ?? rec.score ?? 0} · ${rec.medal ? this.i18n.t('score.medal.' + rec.medal) : this.i18n.t('score.noMedal')}</p></div></div>
      <div class="ov-body"><div class="score-table">
        ${['safety', 'accuracy', 'equipment', 'time', 'efficiency'].map((k) => `
          <div class="st-row"><span>${this.i18n.t('score.' + k)}</span><b class="mono">${b[k] ?? '—'}</b></div>`).join('')}
      </div></div>
      <div class="ov-foot"><button class="btn ghost" data-modal="close">${this.i18n.t('common.close')}</button></div>`;
    this.overlay('score', body, (root) => root.querySelector('[data-modal="close"]').addEventListener('click', () => this.closeOverlay()));
  }
}

/* ------------------------------------------------------------------ helpers */
/** Sprite factories return `{canvas}` wrappers in some cases and bare canvases in others. */
function spriteNode(spr) { return spr?.canvas || spr; }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function prettyKeyName(code) {
  return String(code)
    .replace('Key', '').replace('Digit', '').replace('Numpad', 'Num').replace('Arrow', '')
    .replace('Left', '←').replace('Right', '→').replace('Up', '↑').replace('Down', '↓')
    .replace('Space', 'SPACE').replace('ShiftLeft', 'L-SHIFT').replace('ShiftRight', 'R-SHIFT');
}
const KIND_BY_CHAPTER = {
  induction: 'k-induction', forklift: 'k-training', training: 'k-training',
  containers: 'k-job', yard: 'k-job', gantry: 'k-ship', dock: 'k-ship',
  heavy: 'k-containment', senior: 'k-containment'
};
function kindClass(d) { return KIND_BY_CHAPTER[d.kind] || KIND_BY_CHAPTER[d.chapter] || 'k-job'; }
function iconForObjective(g) {
  switch (g.type) {
    case 'reach': return 'route';
    case 'park': return 'target';
    case 'stop': return 'brake' in ICONS ? 'brake' : 'pause';
    case 'move': case 'reverse': return 'truck';
    case 'horn': return 'horn';
    case 'cycle': return 'spreader';
    case 'lift': case 'liftAny': case 'liftId': case 'liftFromBlock': return 'hook';
    case 'stack': case 'deliver': case 'place': return 'cube';
    case 'clean': case 'damage': return 'shield';
    case 'axis': return 'gear';
    default: return 'target';
  }
}
function enumOptions(key) {
  const map = {
    quality: ['high', 'medium', 'low'].map((v) => ({ value: v, key: `settings.quality.${v}` })),
    fpsCap: [
      { value: 0, key: 'settings.fps.auto' },
      { value: 30, key: 'settings.fps.30' },
      { value: 60, key: 'settings.fps.60' }
    ],
    touchControls: ['auto', 'on', 'off'].map((v) => ({ value: v, key: `settings.touch.${v}` })),
    assist: ['easy', 'normal', 'hard'].map((v) => ({ value: v, key: `settings.difficulty.${v}` }))
  };
  return map[key] || null;
}

export default Screens;
