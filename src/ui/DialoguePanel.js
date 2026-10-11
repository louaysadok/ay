/**
 * DialoguePanel.js — THE PORT MENTOR's face.
 *
 * Two modes share one panel:
 *   • speech  — he talks, you press Next (scripted tutorial / lesson beats)
 *   • ask     — the "Ask the Mentor" hub with context-aware topics
 *
 * Mentor identity is fixed: Sam Kowalski, navy hard hat, hi-vis vest with
 * reflective bands, grey beard. The portrait is drawn procedurally at boot so
 * there are no image assets to ship.
 */
import { SpriteFactory as SF } from '../render/SpriteFactory.js';
import { MENTOR_TOPICS } from '../education/Mentor.js';
import { iconEl } from './Icons.js';

export class DialoguePanel {
  constructor({ layer, mentor, i18n, bus, terminal, missions, settings, audio, onClose }) {
    this.layer = layer || document.getElementById('dialogue-layer');
    this.mentor = mentor;
    this.i18n = i18n;
    this.bus = bus;
    this.terminal = terminal;
    this.missions = missions;
    this.settings = settings;
    this.audio = audio;
    this.onClose = onClose;
    this.mode = null;      // 'speech' | 'ask'
    this.queue = [];
    this.ctxProvider = () => ({});
    this.portraitDrawn = false;
    this._bind();
  }

  _bind() {
    this.els = {
      root: this.layer?.querySelector('.dialogue') || document.getElementById('dialogue'),
      portrait: document.getElementById('mentor-portrait'),
      text: document.getElementById('dlg-text'),
      options: document.getElementById('dlg-options'),
      close: document.getElementById('dlg-close'),
      role: this.layer?.querySelector('.dlg-name i'),
      name: this.layer?.querySelector('.dlg-name b')
    };
    this.els.close?.addEventListener('click', () => this.hide());
    this.layer?.addEventListener('click', (e) => { if (e.target === this.layer) this.hide(); });
    this.mentor.onSpeak = (payload) => this.speak(payload);
  }

  /* ---------------------------------------------------------------- portrait */
  drawPortrait() {
    const c = this.els.portrait;
    if (!c || this.portraitDrawn) return;
    try {
      const spr = SF.mentorPortrait(256);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(spr.canvas || spr, 0, 0, c.width, c.height);
      this.portraitDrawn = true;
    } catch (err) {
      // portrait is decorative — never let it break the panel
      console.warn('[dialogue] portrait failed', err);
    }
  }

  /* ------------------------------------------------------------------ speech */
  speak({ texts, options = [], topic = null }) {
    this.mode = 'speech';
    this.queue = [...texts];
    this.pendingOptions = options;
    this.topic = topic;
    this.show();
    this.next();
  }

  /** Advance the speech queue; when empty, show the options. */
  next() {
    const line = this.queue.shift();
    if (line) {
      this.setLine(line);
      const more = this.queue.length > 0;
      this.renderOptions([{ label: this.i18n.t(more ? 'common.continue' : 'common.ok'), action: 'next', primary: true }].concat(
        more ? [] : (this.pendingOptions || []).filter((o) => o.action !== 'next')
      ));
      return;
    }
    if (this.pendingOptions?.length) {
      this.renderOptions(this.pendingOptions);
      return;
    }
    this.hide();
  }

  show() {
    this.layer?.classList.remove('is-hidden');
    document.body.classList.add('dialogue-open');
    this.drawPortrait();
    if (this.els.name) this.els.name.textContent = this.i18n.t('mentor.name');
    if (this.els.role) this.els.role.textContent = this.i18n.t('mentor.role');
    this.audio?.play?.('ui_open');
    this.bus?.emit('dialogue:opened', { mode: this.mode });
  }

  hide() {
    this.layer?.classList.add('is-hidden');
    document.body.classList.remove('dialogue-open');
    this.mentor.open = false;
    this.mode = null;
    this.audio?.play?.('ui_close');
    this.bus?.emit('dialogue:closed', {});
    this.onClose?.();
  }

  setLine(text) {
    if (!this.els.text) return;
    this.els.text.textContent = text;
    this.els.text.classList.remove('in');
    void this.els.text.offsetWidth;
    this.els.text.classList.add('in');
    this.audio?.dialogueBlip?.(text.length);
  }

  renderOptions(options) {
    const host = this.els.options;
    if (!host) return;
    host.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'dlg-opt' + (o.primary ? ' primary' : '') + (o.locked ? ' locked' : '');
      if (o.icon) b.appendChild(iconEl(o.icon, 'ico'));
      const span = document.createElement('span');
      span.textContent = o.label;
      b.appendChild(span);
      b.disabled = !!o.locked;
      b.addEventListener('click', () => this.choose(o));
      host.appendChild(b);
    }
  }

  choose(option) {
    this.audio?.play?.('ui_click');
    switch (option.action) {
      case 'next': return this.next();
      case 'close': return this.hide();
      case 'repeat':
        this.sayAgain();
        return;
      default: {
        const [kind, value] = String(option.action || '').split(':');
        if (kind === 'topic') return this.askTopic(value);
        this.bus?.emit('dialogue:option', { option });
        if (option.action === 'close') this.hide();
        return;
      }
    }
  }

  /** Replay the last thing he said (there is always a way back). */
  sayAgain() {
    const topics = this.mentor.history.slice(-2);
    if (!topics.length) return this.ask();
    this.mode = 'speech';
    this.queue = topics;
    this.pendingOptions = [{ label: this.i18n.t('mentor.topic.again'), action: 'close', primary: true }];
    this.next();
  }

  /* --------------------------------------------------------------------- ask */
  ask(topic = null) {
    this.drawPortrait();
    this.mode = 'ask';
    this.show();
    if (topic) return this.askTopic(topic);
    const ctx = this.ctxProvider();
    const topics = this.mentor.topics(ctx);
    this.setLine(this.i18n.t('mentor.ask'));
    this.renderOptions(topics.map((t) => ({ label: t.label, icon: t.icon, action: 'topic:' + t.id }))
      .concat([{ label: this.i18n.t('mentor.close'), action: 'close' }]));
  }

  askTopic(id) {
    const ctx = this.ctxProvider();
    ctx.keyLabel = (action) => this.keyLabel(action);
    const answer = this.mentor.answer(id, ctx);
    this.mode = 'ask';
    this.setLine(answer);
    const topics = this.mentor.topics(ctx);
    const opts = topics.filter((t) => t.id !== id)
      .map((t) => ({ label: t.label, icon: t.icon, action: 'topic:' + t.id }));
    opts.push({ label: this.i18n.t('mentor.repeat'), action: 'repeat', icon: 'refresh' });
    opts.push({ label: this.i18n.t('common.close'), action: 'close' });
    this.renderOptions(opts);
    this.bus?.emit('mentor:answer', { topic: id });
  }

  keyLabel(action) {
    const codes = (this.settings.get('bindings') || {})[action] || [];
    return codes.length ? codes.map((c) => String(c).replace('Key', '').replace('Arrow', '')).join('/') : '—';
  }

  toggle() {
    if (this.layer && !this.layer.classList.contains('is-hidden')) this.hide();
    else this.ask();
  }
  get isOpen() { return !!this.layer && !this.layer.classList.contains('is-hidden'); }
}

export default DialoguePanel;
