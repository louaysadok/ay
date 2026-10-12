/**
 * InputManager.js — one logical action layer on top of keyboard, mouse,
 * touch buttons, virtual joystick and gamepads.
 *
 *  input.isDown('forward')      // held
 *  input.pressed('interact')    // edge, true for one simulation step
 *  input.axis('left','right')   // -1..1
 *  input.joystick               // {x:-1..1 steering, y:-1..1 throttle}
 */
import { clamp } from './Utils.js';

/** Logical actions and their default keyboard bindings (KeyboardEvent.code). */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  brake: ['Space'],
  interact: ['KeyE'],
  auxUp: ['KeyR'],
  auxDown: ['KeyF'],
  auxLeft: ['KeyT'],
  auxRight: ['KeyG'],
  cycle: ['KeyC'],
  horn: ['KeyH'],
  recenter: ['KeyV'],
  zoomIn: ['BracketRight', 'Equal'],
  zoomOut: ['BracketLeft', 'Minus'],
  map: ['KeyM'],
  mentor: ['KeyQ'],
  help: ['F1'],
  pause: ['Escape']
};

export const BINDING_ORDER = [
  'forward', 'reverse', 'left', 'right', 'brake', 'interact',
  'auxUp', 'auxDown', 'auxLeft', 'auxRight', 'cycle', 'horn',
  'recenter', 'zoomIn', 'zoomOut', 'map', 'mentor', 'help', 'pause'
];

export class InputManager {
  constructor(bindings = {}, bus = null) {
    this.bus = bus;
    this.bindings = {};
    for (const a of BINDING_ORDER) this.bindings[a] = [...(bindings[a] || DEFAULT_BINDINGS[a] || [])];
    this.keys = new Set();          // physical keys held
    this.virtual = new Set();       // touch/mouse buttons held
    this.edge = new Set();          // pressed this frame (physical or virtual)
    this.virtualEdge = new Set();
    this.joystick = { x: 0, y: 0 };
    this.joystickActive = false;
    this.mouse = { x: 0, y: 0, down: false, right: false, dx: 0, dy: 0, wheel: 0 };
    this.gamepad = null;
    this.gamepadEnabled = true;
    this._listening = null;         // {action, resolve} while rebinding
    this._enabled = true;
    this._bound = {
      keydown: (e) => this._onKeyDown(e),
      keyup: (e) => this._onKeyUp(e),
      blur: () => this.clearAll(),
      mousemove: (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; },
      mousedown: (e) => { if (e.button === 0) this.mouse.down = true; if (e.button === 1 || e.button === 2) this.mouse.right = true; },
      mouseup: (e) => { if (e.button === 0) this.mouse.down = false; if (e.button === 1 || e.button === 2) this.mouse.right = false; },
      wheel: (e) => { this.mouse.wheel += Math.sign(e.deltaY); },
      contextmenu: (e) => e.preventDefault()
    };
  }

  attach(target = window) {
    this._target = target;
    target.addEventListener('keydown', this._bound.keydown, { passive: false });
    target.addEventListener('keyup', this._bound.keyup);
    target.addEventListener('blur', this._bound.blur);
    target.addEventListener('mousemove', this._bound.mousemove);
    target.addEventListener('mousedown', this._bound.mousedown);
    target.addEventListener('mouseup', this._bound.mouseup);
    target.addEventListener('wheel', this._bound.wheel, { passive: true });
    target.addEventListener('contextmenu', this._bound.contextmenu);
    window.addEventListener('gamepadconnected', () => { this.gamepadEnabled = true; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
  }
  detach(target = window) {
    target.removeEventListener('keydown', this._bound.keydown);
    target.removeEventListener('keyup', this._bound.keyup);
    target.removeEventListener('blur', this._bound.blur);
    target.removeEventListener('mousemove', this._bound.mousemove);
    target.removeEventListener('mousedown', this._bound.mousedown);
    target.removeEventListener('mouseup', this._bound.mouseup);
    target.removeEventListener('wheel', this._bound.wheel);
    target.removeEventListener('contextmenu', this._bound.contextmenu);
  }

  setEnabled(v) { this._enabled = v; if (!v) this.clearAll(); }

  _onKeyDown(e) {
    // Rebinding capture
    if (this._listening) {
      e.preventDefault();
      const { action, resolve } = this._listening;
      this._listening = null;
      if (e.code !== 'Escape') {
        const taken = BINDING_ORDER.find((a) => a !== action && this.bindings[a].includes(e.code));
        if (taken) this.bindings[taken] = this.bindings[taken].filter((c) => c !== e.code);
        if (!this.bindings[action]) this.bindings[action] = [];
        this.bindings[action] = [e.code, ...this.bindings[action].filter((c) => c !== e.code)].slice(0, 2);
      }
      resolve?.(e.code);
      return;
    }
    if (!this._enabled) return;
    // Keep browser from scrolling / opening quick-find
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', 'Slash'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    const action = this.actionFor(e.code);
    if (action) { this.edge.add(action); this.bus?.emit('input:action', { action, code: e.code }); }
  }
  _onKeyUp(e) { this.keys.delete(e.code); }

  actionFor(code) {
    for (const a of BINDING_ORDER) if (this.bindings[a]?.includes(code)) return a;
    return null;
  }

  /* -------------------------------------------------------------- virtual -- */
  setVirtual(action, down) {
    if (down) {
      if (!this.virtual.has(action)) { this.virtual.add(action); this.virtualEdge.add(action); this.bus?.emit('input:action', { action, code: 'touch' }); }
    } else this.virtual.delete(action);
  }
  setJoystick(x, y) {
    this.joystick.x = clamp(x, -1, 1);
    this.joystick.y = clamp(y, -1, 1);
    this.joystickActive = Math.hypot(this.joystick.x, this.joystick.y) > 0.08;
  }
  clearVirtual() { this.virtual.clear(); this.setJoystick(0, 0); }

  /* ----------------------------------------------------------------- query -- */
  isDown(action) {
    if (this.virtual.has(action)) return true;
    const b = this.bindings[action];
    if (b) for (const c of b) if (this.keys.has(c)) return true;
    return false;
  }
  pressed(action) { return this.edge.has(action) || this.virtualEdge.has(action); }
  axis(neg, pos) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }

  /** Merge keyboard axis with analog joystick (joystick wins if deflected). */
  steerAxis() {
    if (this.joystickActive && Math.abs(this.joystick.x) > 0.08) return this.joystick.x;
    const gp = this._gamepadAxis(0, -1);
    if (gp !== null && Math.abs(gp) > 0.12) return gp;
    return this.axis('left', 'right');
  }
  throttleAxis() {
    if (this.joystickActive && Math.abs(this.joystick.y) > 0.08) return -this.joystick.y;
    const gp = this._gamepadAxis(1, -1);
    if (gp !== null && Math.abs(gp) > 0.12) return -gp;
    return (this.isDown('forward') ? 1 : 0) - (this.isDown('reverse') ? 1 : 0);
  }

  _pollGamepad() {
    if (!this.gamepadEnabled || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.gamepad = p;
      // map a couple of standard buttons onto logical edge actions
      const map = { 0: 'interact', 2: 'auxUp', 1: 'auxDown', 3: 'horn', 9: 'pause' };
      for (const [i, action] of Object.entries(map)) {
        const btn = p.buttons[i];
        const was = this._gpBtn?.[i] || false;
        if (btn?.pressed && !was) this.edge.add(action);
        if (!this._gpBtn) this._gpBtn = {};
        this._gpBtn[i] = !!btn?.pressed;
      }
      return;
    }
    this.gamepad = null;
  }
  _gamepadAxis(i, fallback = 0) {
    const p = this.gamepad;
    if (!p || !p.axes || p.axes[i] === undefined) return null;
    const dead = Math.abs(p.axes[i]) < 0.12 ? fallback * 0 : p.axes[i];
    return dead;
  }

  /** Called at the end of every fixed simulation step. */
  endStep() {
    this.edge.clear();
    this.virtualEdge.clear();
    this.mouse.wheel = 0;
  }
  clearAll() { this.keys.clear(); this.virtual.clear(); this.edge.clear(); this.virtualEdge.clear(); this.setJoystick(0, 0); }

  /* ------------------------------------------------------------- rebinding -- */
  beginRebind(action, resolve) { this._listening = { action, resolve }; }
  cancelRebind() { this._listening = null; }
  get isListening() { return !!this._listening; }
  setBindings(obj) {
    for (const a of BINDING_ORDER) if (obj?.[a]) this.bindings[a] = [...obj[a]];
  }
  serialize() { return JSON.parse(JSON.stringify(this.bindings)); }

  /** Human readable key label. */
  labelFor(action, pretty = true) {
    const codes = this.bindings[action] || [];
    return codes.map((c) => (pretty ? prettyKey(c) : c)).join(' / ') || '—';
  }
  update() { this._pollGamepad(); }
}

/** "KeyW" -> "W", "ArrowUp" -> "↑", "Space" -> "Space". */
export function prettyKey(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  const map = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps',
    BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
    Quote: "'", Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\'
  };
  return map[code] || code;
}
export default InputManager;
