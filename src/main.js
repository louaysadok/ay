/**
 * main.js — PORT OPS SIMULATOR entry point.
 *
 * Boot order (everything is local, nothing is fetched from the network):
 *   1. save + settings        (localStorage)
 *   2. string tables + dialogue (bundled JSON in src/data)
 *   3. audio graph            (created lazily on the first gesture)
 *   4. terminal + machines    (the world)
 *   5. screens / HUD / mentor / touch
 *   6. fixed-step loop
 *
 * All UI is driven by `ui:action` events so the touch controls, the HUD
 * buttons and the keyboard all funnel through one router (`handleAction`).
 */
import { EventBus } from './engine/EventBus.js';
import { GameLoop } from './engine/GameLoop.js';
import { InputManager, prettyKey } from './engine/InputManager.js';
import { Loader } from './systems/Loader.js';
import { SaveManager } from './systems/SaveManager.js';
import { SettingsManager } from './systems/SettingsManager.js';
import { Localization } from './systems/Localization.js';
import { AudioManager } from './systems/AudioManager.js';
import { Mentor } from './education/Mentor.js';
import { Game } from './gameplay/Game.js';
import { HUD } from './ui/HUD.js';
import { Screens } from './ui/Screens.js';
import { DialoguePanel } from './ui/DialoguePanel.js';
import { TouchControls } from './ui/TouchControls.js';
import { Toaster } from './ui/Toast.js';
import { mountIcons } from './ui/Icons.js';

const bus = new EventBus();
const app = { bus };

boot().catch((err) => {
  console.error('[portops] boot failed', err);
  const line = document.getElementById('boot-status');
  if (line) line.textContent = `Startup problem: ${err?.message || err}. Reload the page to try again.`;
});

async function boot() {
  /* ---------------------------------------------------------------- stage */
  const canvas = document.getElementById('game');
  const stage = document.getElementById('stage');
  const screensEl = document.getElementById('screens');
  screensEl?.classList.remove('is-hidden');
  mountIcons();

  /* ------------------------------------------------------------ systems  */
  app.save = new SaveManager(bus);
  app.save.loadProfile();
  app.settings = new SettingsManager(app.save, bus);
  app.i18n = new Localization(bus);
  app.audio = new AudioManager(bus, app.settings);
  app.input = new InputManager(app.settings.get('bindings'), bus);
  app.toaster = new Toaster({ root: document.getElementById('toasts'), i18n: app.i18n, bus });
  app.loader = new Loader(bus, app.i18n);

  /* ----------------------------------------------------------- screens   */
  const screens = new Screens({
    bus, i18n: app.i18n, settings: app.settings, saveManager: app.save, save: app.save,
    machines: {}, lessons: null, career: null, audio: app.audio, game: null, mentor: null, progression: null
  });
  app.screens = screens;

  /* ------------------------------------------------------------ data     */
  screens.bootProgress(0.05, 'common.loading');
  const data = await app.loader.loadAll((p, key) => screens.bootProgress(p, key));
  app.layout = data.terminal;
  app.machines = data.machines;
  app.lessons = data.lessons;
  app.career = data.missions;
  app.dialogue = data.dialogue;
  screens.machines = app.machines;
  screens.lessons = app.lessons;
  screens.career = app.career;

  /* ------------------------------------------------------------ language */
  app.i18n.setLanguage(app.settings.get('language'));
  screens.applyI18n();
  screens.renderBootArt();

  /* ------------------------------------------------------------- audio   */
  app.audio.init?.();
  app.audio.hook(bus);
  if (app.settings.get('music')) app.audio.startMusic?.();

  /* ------------------------------------------------------------- mentor  */
  app.mentor = new Mentor({
    bus, i18n: app.i18n, save: app.save, terminal: null,
    missions: null, settings: app.settings
  });
  app.mentor.lines = app.dialogue;

  /* --------------------------------------------------------------- game  */
  const game = new Game({
    bus, canvas, stage, i18n: app.i18n, save: app.save, settings: app.settings,
    audio: app.audio, screens, machines: app.machines, layout: app.layout,
    lessons: app.lessons, career: app.career, mentor: app.mentor, input: app.input
  });
  app.game = game;
  screens.game = game;
  screens.mentor = app.mentor;
  screens.progression = game.progression;
  app.mentor.missions = game.missionManager;

  screens.bootProgress(0.55, 'boot.loading');
  const world = await game.createWorld();
  app.world = world;

  /* ---------------------------------------------------------------- HUD  */
  const hud = new HUD({
    bus, i18n: app.i18n, settings: app.settings, terminal: world.terminal, save: app.save,
    missions: game.missionManager, mentor: app.mentor, audio: app.audio, machineSpecs: app.machines
  });
  hud.mount();
  hud.setTerrain(world.terrain);
  game.hud = hud;
  app.hud = hud;

  /* ------------------------------------------------------------ dialogue */
  const dialogue = new DialoguePanel({
    layer: document.getElementById('dialogue-layer'), mentor: app.mentor, i18n: app.i18n,
    bus, terminal: world.terminal, missions: game.missionManager, settings: app.settings, audio: app.audio
  });
  dialogue.ctxProvider = () => ({
    vehicle: game.player, mission: game.missionManager.active, settings: app.settings
  });
  app.dialogue = dialogue;

  /* --------------------------------------------------------- touch layer */
  const touch = new TouchControls({
    root: document.getElementById('touch'), bus, settings: app.settings, i18n: app.i18n,
    input: app.input, terminal: world.terminal
  });
  touch.mount();
  touch.attachGestures(canvas, world.camera, app.input);
  game.touch = touch;
  app.touch = touch;

  /* --------------------------------------------------------------- input */
  app.input.attach(window);
  wireInput();

  /* ---------------------------------------------------------------- loop */
  const loop = new GameLoop({
    update: (dt) => game.update(dt),
    render: (alpha, dt, paused) => game.render(alpha, dt, paused),
    onFps: (fps) => { app.fps = fps; }
  });
  game.loop = loop;
  app.loop = loop;

  /* -------------------------------------------------------------- resize */
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 240));
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('pointerdown', firstGesture, { once: true });
  window.addEventListener('keydown', firstGesture, { once: true });

  /* ------------------------------------------------------------- events  */
  bus.on('ui:action', ({ action, machine }) => handleAction(action, machine));
  bus.on('settings:changed', onSettingsChanged);
  bus.on('save:checkpoint', () => { if (app.settings.get('autosave')) app.save.saveProfile(); });
  window.addEventListener('beforeunload', () => app.save.saveProfile(true));

  /* -------------------------------------------------------------- start  */
  screens.mount();
  screens.bootProgress(1, 'boot.ready');
  setTimeout(() => {
    screens.showScreen('menu');
    screens.refreshMenu();
    loop.start();
    if (!app.save.profile.tutorial.skipped && !app.mentor.hasSeen('mentor.welcome')) {
      app.mentor.startTutorial();
    }
  }, 420);
}

/* ===================================================================== */
/*  router                                                               */
/* ===================================================================== */
function handleAction(action, arg) {
  const g = app.game;
  switch (action) {
    case 'pause': return app.screens.overlayOpen ? app.screens.closeOverlay() : g.pause();
    case 'resume': return g.resume();
    case 'mentor': return app.dialogue.toggle();
    case 'codex': return app.screens.dispatch('codex');
    case 'settings': return app.screens.dispatch('settings');
    case 'machine':
      if (g.canSwitch) g.setPlayer(arg);
      return;
    case 'menu': return g.toMenu();
    case 'restart': return g.restart();
    default: break;
  }
}

function wireInput() {
  const bus = app.bus;
  // discrete keys are edge events from InputManager -> the same router as the buttons
  bus.on('input:action', ({ action }) => {
    switch (action) {
      case 'pause':
        if (app.screens.overlayOpen) app.screens.closeOverlay();
        else if (app.game.state === 'playing') app.game.pause();
        else if (app.game.state === 'paused') app.game.resume();
        break;
      case 'mentor':
        if (app.game.state === 'playing' || app.game.state === 'paused') app.dialogue.toggle();
        break;
      case 'map': app.hud.toggleMinimap(); break;
      case 'help': app.screens.dispatch('codex'); break;
      default: break;
    }
  });
}

function onSettingsChanged({ key, value }) {
  const { settings, world, game, i18n, audio, screens } = app;
  if (key === 'language' || key === '*') i18n.setLanguage(settings.get('language'));
  if (key === 'quality' || key === '*') {
    if (world?.renderer) world.renderer.quality = settings.get('quality');
    if (world?.camera) world.camera.zoomSmoothing = settings.get('zoomSmooth') ? 6 : 40;
  }
  if (key === 'cameraShake' || key === '*') { if (world?.camera) world.camera.shakeEnabled = settings.get('cameraShake'); }
  if (key === 'showZones' || key === '*') { if (world?.renderer) world.renderer.showZones = settings.get('showZones'); }
  if (key === 'music' || key === 'muted' || key === '*') {
    if (settings.get('music') && !settings.get('muted')) audio.startMusic?.(); else audio.stopMusic?.();
  }
  if (key === 'touchControls' || key === '*') {
    const on = TouchControls.shouldEnable(settings);
    game.touchEnabled = on;
    app.touch?.setEnabled(on && game.state === 'playing');
    document.body.classList.toggle('is-touch', on);
  }
  if (key === 'hudScale' || key === '*') {
    document.documentElement.style.setProperty('--hud-scale', settings.get('hudScale'));
  }
  if (key === 'vignette' || key === '*') {
    document.getElementById('stage-shade')?.classList.toggle('vignette-off', !settings.get('vignette'));
  }
  if (key === 'showMinimap' || key === '*') {
    const mm = document.getElementById('hud-minimap');
    if (mm) mm.classList.toggle('is-hidden', !settings.get('showMinimap'));
  }
  screens?.applyI18n?.();
}

/* ===================================================================== */
/*  viewport / lifecycle                                                 */
/* ===================================================================== */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  app.world?.renderer?.resize(w, h, dpr);
  app.world?.camera?.resize(w, h);
  document.documentElement.style.setProperty('--vh', `${h * 0.01}px`);
  app.bus.emit('view:resized', { w, h, dpr });
}

function onVisibility() {
  if (document.hidden) {
    if (app.game.state === 'playing') { app.game.pause(); }
    app.loop?.stop();
    app.audio?.stopEngine?.();
  } else {
    app.loop?.start();
    if (app.game.state === 'playing') app.audio?.startEngine?.(app.game.player);
  }
}

function firstGesture() {
  app.audio?.unlock?.();
  // touch controls appear once we know the device is touch-driven
  const enabled = TouchControls.shouldEnable(app.settings);
  app.game.touchEnabled = enabled;
  app.touch?.setEnabled(enabled && app.game.state === 'playing');
  // drives the touch-specific HUD arrangement in mobile.css
  document.body.classList.toggle('is-touch', enabled);
  if (app.settings.get('music') && !app.settings.get('muted')) app.audio?.startMusic?.();
}

/* keyboard help overlay uses prettyKey for labels */
app.prettyKey = prettyKey;
window.__portops = app;
