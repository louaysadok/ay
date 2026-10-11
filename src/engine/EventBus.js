/**
 * EventBus.js — tiny publish/subscribe hub.
 * Systems (audio, HUD, mentor, scoring) listen to simulation events instead of
 * being wired directly into the machinery code.
 */
export class EventBus {
  constructor() { this.map = new Map(); this.any = new Set(); this.log = []; }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  onAny(fn) { this.any.add(fn); return () => this.any.delete(fn); }

  emit(type, payload = {}) {
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) { try { fn(payload, type); } catch (e) { console.error(`[EventBus] ${type}`, e); } }
    for (const fn of [...this.any]) { try { fn(payload, type); } catch (e) { console.error('[EventBus]', e); } }
    this.log.push({ type, t: performance.now() });
    if (this.log.length > 400) this.log.splice(0, 200);
  }
  clear() { this.map.clear(); this.any.clear(); }
}
export const bus = new EventBus();
export default bus;
