/**
 * GameLoop.js — fixed-timestep simulation with interpolated rendering.
 *
 *   const loop = new GameLoop({ update:(dt)=>..., render:(alpha,dt)=>... });
 *   loop.start();
 *
 * The simulation always advances in FIXED_DT steps so machinery physics and
 * mission logic behave identically at 30, 60 or 144 FPS. Rendering runs once
 * per animation frame using the leftover accumulator as an interpolation alpha.
 */
export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;      // protects against "spiral of death"
export const QUALITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

export class GameLoop {
  constructor({ update, render, fixedDt = FIXED_DT, onFps = null } = {}) {
    this.updateFn = update || (() => {});
    this.renderFn = render || (() => {});
    this.fixedDt = fixedDt;
    this.acc = 0;
    this.lastTime = 0;
    this.running = false;
    this.paused = false;
    this.raf = 0;
    this.elapsed = 0;          // simulated seconds (excludes paused time)
    this.realElapsed = 0;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsCount = 0;
    this._fpsTimer = 0;
    this.onFps = onFps;
    this.timeScale = 1;
    this.maxDelta = 0.25;      // clamp huge frame gaps (tab switches)
    this.steps = 0;
    this._boundTick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this._boundTick);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  pause() { this.paused = true; }
  resume() { if (this.paused) { this.paused = false; this.lastTime = performance.now(); this.acc = 0; } }
  togglePause() { this.paused ? this.resume() : this.pause(); return this.paused; }

  _tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._boundTick);
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (delta > this.maxDelta) delta = this.maxDelta;
    this.realElapsed += delta;

    // ---- FPS meter (smoothed over ~0.5 s) --------------------------------
    this._fpsAcc += delta; this._fpsCount++; this._fpsTimer += delta;
    if (this._fpsTimer >= 0.5) {
      this.fps = this._fpsCount / this._fpsAcc;
      this.onFps?.(this.fps);
      this._fpsAcc = 0; this._fpsCount = 0; this._fpsTimer = 0;
    }

    if (this.paused) {
      this.renderFn(1, delta, true);   // keep drawing the frozen world (blur behind menus)
      return;
    }

    const scaled = delta * this.timeScale;
    this.acc += scaled;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < MAX_STEPS_PER_FRAME) {
      this.updateFn(this.fixedDt, this.elapsed);
      this.elapsed += this.fixedDt;
      this.acc -= this.fixedDt;
      steps++;
      this.steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;   // drop surplus rather than lag-spike
    this.renderFn(this.acc / this.fixedDt, delta, false);
  }
}
export default GameLoop;
