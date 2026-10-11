/**
 * Toast.js — short, non-blocking messages.
 *
 * Markup matches styles/main.css: `.toast` with an `.ico` and text; the entry
 * and exit animations are CSS-driven, so this class only manages lifetimes.
 */
export class Toaster {
  constructor({ root, i18n, bus, max = 4 }) {
    this.root = root;
    this.i18n = i18n;
    this.bus = bus;
    this.max = max;
    this.items = [];
    this._bound = false;
  }

  hook(bus = this.bus) {
    if (!bus || this._bound) return;
    this._bound = true;
    bus.on('toast', (p) => this.show(p));
    bus.on('cargo:rejected', ({ code, message, vehicle }) => {
      if (vehicle && this.playerCheck && vehicle !== this.playerCheck()) return;
      const key = {
        capacity: 'toast.capacity', 'capacity-row': 'toast.capacity', radius: 'toast.capacity',
        attachment: 'toast.wrongAttachment', 'spreader-size': 'toast.wrongAttachment'
      }[code];
      // always show the machine's own explanation — it names the fix
      this.show({ text: message, key: key && !message ? key : null, icon: 'warn', tone: 'warn' });
    });
    bus.on('machine:impact', ({ severity, vehicle }) => {
      if (vehicle && this.playerCheck && vehicle !== this.playerCheck()) return;
      if (severity > 0.8) this.show({ key: 'toast.impact', icon: 'warn', tone: 'bad' });
    });
    bus.on('safety:pedestrian', () => this.show({ key: 'toast.pedNear', icon: 'warn', tone: 'bad' }));
    bus.on('safety:zoneEntered', ({ name }) => this.show({ key: 'toast.zoneEntered', vars: { zone: name || '' }, icon: 'warn', tone: 'warn' }));
    bus.on('mission:started', ({ mission }) => this.show({ key: 'toast.missionStarted', vars: { name: mission.title }, icon: 'route', tone: 'info', life: 4200 }));
    bus.on('mission:complete', ({ mission }) => this.show({ key: 'toast.missionComplete', vars: { name: mission.title }, icon: 'medal', tone: 'good' }));
    bus.on('mission:failed', ({ mission }) => this.show({ key: 'toast.missionFailed', vars: { name: mission.title }, icon: 'x', tone: 'bad' }));
    bus.on('mission:objective', ({ objective }) => this.show({ text: objective.label, icon: 'check', tone: 'good', life: 2200 }));
    bus.on('progression:unlocked', ({ name }) => this.show({ key: 'toast.unlocked', vars: { machine: name }, icon: 'unlock', tone: 'good', life: 5000 }));
    bus.on('progression:levelup', ({ level }) => this.show({ key: 'toast.levelUp', vars: { level }, icon: 'star', tone: 'good', life: 5000 }));
    bus.on('progression:achievement', ({ def, id }) => {
      this.show({ key: 'toast.achievement', vars: { name: def?.name || id }, icon: 'medal', tone: 'good', life: 5000 });
    });
    bus.on('machine:couple', () => this.show({ text: 'Trailer coupled.', icon: 'hook', tone: 'good' }));
    bus.on('machine:uncouple', () => this.show({ text: 'Trailer released.', icon: 'hook', tone: 'muted' }));
    bus.on('machine:error', ({ text }) => this.show({ text, icon: 'warn', tone: 'warn' }));
    bus.on('save:profile', () => { /* silent: autosaves are not worth a toast */ });
  }

  /** show({key, vars, text, icon, tone, life}) */
  show(opts = {}) {
    if (!this.root) return;
    if (typeof opts === 'string') opts = { text: opts };
    const body = opts.text || (opts.key && this.i18n ? this.i18n.t(opts.key, opts.vars || {}) : '');
    if (!body || body === opts.key) return;
    const el = document.createElement('div');
    el.className = `toast ${opts.tone || 'info'}`;
    el.innerHTML = `<span class="ico"></span><span class="toast-text"></span>`;
    const ico = el.querySelector('.ico');
    if (opts.icon) ico.setAttribute('data-icon', opts.icon); else ico.remove();
    el.querySelector('.toast-text').textContent = body;
    this.root.appendChild(el);
    import('./Icons.js').then(({ mountIcons }) => mountIcons(el)).catch(() => { });

    const item = { el, life: opts.life ?? 3000 };
    this.items.push(item);
    while (this.items.length > this.max) this._remove(this.items[0]);
    item.timer = setTimeout(() => this._remove(item), item.life);
    el.addEventListener('click', () => this._remove(item));
  }

  _remove(item) {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    clearTimeout(item.timer);
    item.el.classList.add('done');
    setTimeout(() => item.el.remove(), 320);
  }

  clear() { [...this.items].forEach((i) => this._remove(i)); }
}

export default Toaster;
