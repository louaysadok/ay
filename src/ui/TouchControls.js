/**
 * TouchControls.js — landscape touch interface for Android / tablets.
 *
 * This is NOT a shrunk desktop UI: the machine is driven by a floating
 * joystick on the left thumb (steer + throttle), a dedicated brake pedal, and
 * a column of large load/auxiliary buttons on the right thumb whose labels come
 * from the active machine's own control list. Buttons are at least 64 px and
 * fade out when the player is not touching the screen, so the terminal stays
 * visible.
 */
import { iconEl } from './Icons.js';

const AXIS_ACTIONS = {
  forkHeight: [['auxUp'], ['auxDown']],
  boomAngle: [['auxUp'], ['auxDown']],
  boomExtend: [['auxLeft'], ['auxRight']],
  trolleyPos: [['auxLeft'], ['auxRight']],
  hoistHeight: [['auxUp'], ['auxDown']],
  hookDepth: [['auxUp'], ['auxDown']]
};

export class TouchControls {
  constructor({ root, bus, settings, i18n, input, terminal }) {
    this.root = root || document.getElementById('touch');
    this.bus = bus;
    this.settings = settings;
    this.i18n = i18n;
    this.input = input;
    this.terminal = terminal;
    this.machine = null;
    this.enabled = false;
    this.visible = false;
    this._build();
    this._wired = false;
  }

  /* ------------------------------------------------------------------ build */
  _build() {
    this.els = {
      joystick: document.getElementById('t-joystick'),
      knob: document.getElementById('t-knob'),
      fwd: document.getElementById('t-fwd'),
      rev: document.getElementById('t-rev'),
      brake: document.getElementById('t-brake'),
      actions: document.getElementById('t-actions'),
      mentor: document.getElementById('t-mentor'),
      pause: document.getElementById('t-pause'),
      horn: document.getElementById('t-horn')
    };
  }

  mount() {
    if (this._wired) return;
    this._wired = true;
    this._bindJoystick();
    this._bindPedals();
    this._bindRound();
    this.root?.addEventListener('pointerdown', () => this.nudge(true), { passive: true });
    this.root?.addEventListener('pointerup', () => this.nudge(false), { passive: true });
  }

  setEnabled(on) {
    this.enabled = on;
    this.root?.classList.toggle('is-hidden', !on);
    if (!on) this.releaseAll();
  }

  /** Simple heuristic: show touch controls on coarse pointers / small screens. */
  static shouldEnable(settings) {
    const mode = settings.get('touchControls');
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const small = Math.min(window.innerWidth, window.innerHeight) < 820;
    return !!(coarse || (touch && small));
  }

  /* --------------------------------------------------------------- joystick */
  _bindJoystick() {
    const js = this.els.joystick;
    const knob = this.els.knob;
    if (!js || !knob) return;
    let active = null;
    const R = 58;
    const reset = () => {
      active = null;
      knob.style.transform = 'translate(-50%, -50%)';
      js.classList.remove('active');
      this.input?.setJoystick(0, 0);
      this.joystick = { x: 0, y: 0 };
    };
    js.addEventListener('pointerdown', (e) => {
      js.setPointerCapture(e.pointerId);
      active = { id: e.pointerId, rect: js.getBoundingClientRect() };
      js.classList.add('active');
      move(e);
    });
    const move = (e) => {
      if (!active || e.pointerId !== active.id) return;
      const cx = active.rect.left + active.rect.width / 2;
      const cy = active.rect.top + active.rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const leftHanded = this.settings.get('leftHanded');
      if (leftHanded) dx = -dx;
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / R, ny = dy / R;
      this.joystick = { x: nx, y: ny };
      this.input?.setJoystick(nx, -ny);
      this.nudge(true);
    };
    js.addEventListener('pointermove', move);
    juSafe(js, 'pointerup', reset);
    juSafe(js, 'pointercancel', reset);
    juSafe(js, 'lostpointercapture', reset);
    reset();
  }

  /* ----------------------------------------------------------------- pedals */
  _bindPedals() {
    const hold = (el, action) => {
      if (!el) return;
      const down = (e) => { e.preventDefault(); el.classList.add('down'); this.input?.setVirtual(action, true); this.nudge(true); };
      const up = () => { el.classList.remove('down'); this.input?.setVirtual(action, false); };
      el.addEventListener('pointerdown', down);
      juSafe(el, 'pointerup', up);
      juSafe(el, 'pointercancel', up);
      juSafe(el, 'pointerleave', up);
    };
    hold(this.els.fwd, 'forward');
    hold(this.els.rev, 'reverse');
    hold(this.els.brake, 'brake');
  }

  _bindRound() {
    const tap = (el, fn) => {
      if (!el) return;
      el.addEventListener('click', (e) => { e.preventDefault(); fn(); this.nudge(true); });
    };
    tap(this.els.mentor, () => this.bus.emit('ui:action', { action: 'mentor' }));
    tap(this.els.pause, () => this.bus.emit('ui:action', { action: 'pause' }));
    tap(this.els.horn, () => {
      this.input?.setVirtual('horn', true);
      setTimeout(() => this.input?.setVirtual('horn', false), 240);
    });
  }

  nudge(active) {
    if (!this.enabled) return;
    this.root?.classList.toggle('dim', !active);
  }

  releaseAll() {
    this.input?.clearVirtual();
    this.els.joystick?.classList.remove('active');
    if (this.els.knob) this.els.knob.style.transform = 'translate(-50%, -50%)';
    this.els.actions?.querySelectorAll('.t-btn').forEach((b) => b.classList.remove('down'));
  }

  /* -------------------------------------------------------- machine action bar */
  /** Rebuild the right-hand button column for the machine in the cab. */
  setMachine(vehicle) {
    if (!vehicle || vehicle.type === this.machine) return;
    this.machine = vehicle.type;
    const host = this.els.actions;
    if (!host) return;
    host.innerHTML = '';
    const spec = vehicle.spec;
    const controls = (spec.controls || []).filter((c) =>
      !['forward', 'reverse', 'left', 'right', 'brake', 'horn', 'interact'].includes(c.action));

    // 1) the big load button (pick up / set down) — always first and largest
    const load = this._button('interact', 'hook', this.i18n.t(vehicle.load ? 'hud.prompt.place' : 'hud.prompt.pick'), 'big');
    load.classList.add('primary');
    load.dataset.hold = 'tap';
    host.appendChild(load);

    // 2) auxiliary buttons from the spec
    for (const c of controls) {
      const iconName = actionIcon(c.action, spec);
      const b = this._button(c.action, iconName, c.label);
      b.dataset.hold = 'hold';
      host.appendChild(b);
    }

    this._mountActions(host);
  }

  _button(action, icon, label, cls = '') {
    const b = document.createElement('button');
    b.className = `t-btn t-act ${cls}`;
    b.dataset.action = action;
    b.innerHTML = `<span class="ico"></span><span class="t-label"></span>`;
    const ico = b.querySelector('.ico');
    ico.setAttribute('data-icon', icon);
    b.querySelector('.t-label').textContent = shortLabel(label);
    return b;
  }

  _mountActions(host) {
    import('./Icons.js').then(({ mountIcons }) => mountIcons(host)).catch(() => { });
    host.querySelectorAll('.t-act').forEach((b) => {
      const action = b.dataset.action;
      const hold = b.dataset.hold === 'hold';
      const down = (e) => {
        e.preventDefault();
        b.classList.add('down');
        this.input?.setVirtual(action, true);
        if (hold) { /* held until pointerup */ } else { setTimeout(() => this.input?.setVirtual(action, false), 120); }
        this.nudge(true);
      };
      const up = () => { b.classList.remove('down'); this.input?.setVirtual(action, false); };
      b.addEventListener('pointerdown', down);
      juSafe(b, 'pointerup', up);
      juSafe(b, 'pointercancel', up);
      juSafe(b, 'pointerleave', up);
    });
  }

  /** Swipe gestures on the canvas: pinch to zoom, drag to look around. */
  attachGestures(canvas, camera, input) {
    if (!canvas) return;
    let pointers = new Map();
    let lastPinch = 0;
    let panning = false;
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      } else if (pointers.size === 1) {
        panning = false;
        this._panStart = { x: e.clientX, y: e.clientY, cam: { x: camera.x, y: camera.y } };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) {
          const k = d / lastPinch;
          const invert = this.settings.get('invertZoom') ? -1 : 1;
          camera.zoomBy?.(Math.pow(k, invert));
        }
        lastPinch = d;
        panning = true;
      } else if (pointers.size === 1 && this._panStart) {
        const dx = e.clientX - this._panStart.x;
        const dy = e.clientY - this._panStart.y;
        if (Math.hypot(dx, dy) > 18) panning = true;
        if (panning) {
          camera.panTo?.(
            this._panStart.cam.x - dx / camera.zoom,
            this._panStart.cam.y - dy / camera.zoom
          );
          input?.setJoystick(input.joystick?.x ?? 0, input.joystick?.y ?? 0);
        }
      }
    });
    const clear = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) lastPinch = 0; };
    juSafe(canvas, 'pointerup', clear);
    juSafe(canvas, 'pointercancel', clear);
  }
}

/* ------------------------------------------------------------------ helpers */
function juSafe(el, type, fn) {
  el?.addEventListener(type, fn, { passive: true });
}
function shortLabel(label = '') {
  const words = String(label).split(' ');
  if (words.length <= 2) return label;
  return words.slice(0, 2).join(' ');
}
function actionIcon(action, spec) {
  switch (action) {
    case 'auxUp': case 'auxDown':
      return spec.attachment === 'hook' ? 'hook' : spec.attachment === 'spreader' ? 'spreader' : 'up';
    case 'auxLeft': case 'auxRight': return 'left';
    case 'cycle': return 'rotate';
    case 'interact': return 'hook';
    default: return 'gear';
  }
}

export default TouchControls;
