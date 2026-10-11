/**
 * tools/smoke.mjs — headless integration test for the whole game.
 *
 * Boots the real systems (save, settings, i18n, audio, loader, mentor, HUD,
 * screens, dialogue, touch) against a minimal DOM stub, builds the terminal,
 * then drives a machine for a few hundred simulation steps: it lifts a pallet,
 * places it, switches machines, finishes a mission and renders frames.
 *
 *   node tools/smoke.mjs [--svg]
 *
 * Exits non-zero on the first failure so it can gate a build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordingCanvas, canvasToSvg } from './svgcanvas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];
const t0 = performance.now();

function ok(name) { console.log(`  \u2713 ${name}`); }
function fail(name, err) {
  failures.push({ name, err });
  console.log(`  \u2717 ${name}\n      ${err?.stack?.split('\n').slice(0, 3).join('\n      ') || err}`);
}
async function step(name, fn) {
  try { await fn(); ok(name); } catch (e) { fail(name, e); }
}

/* ------------------------------------------------------------------ DOM --- */
function makeStyle() {
  const props = {};
  return {
    getPropertyValue: (k) => props[k] ?? '',
    setProperty: (k, v) => { props[k] = v; },
    removeProperty: (k) => { delete props[k]; },
    ...props
  };
}
function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    dataset: {},
    style: makeStyle(),
    children: [],
    innerHTML: '',
    textContent: '',
    title: '',
    value: '',
    checked: false,
    files: [],
    hidden: false,
    _classes: new Set(),
    classList: {
      add: (...c) => c.forEach((x) => el._classes.add(x)),
      remove: (...c) => c.forEach((x) => el._classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !el._classes.has(c) : !!force;
        on ? el._classes.add(c) : el._classes.delete(c);
        return on;
      },
      contains: (c) => el._classes.has(c)
    },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    remove() { },
    insertBefore(c) { el.children.push(c); return c; },
    setAttribute(k, v) { if (k === 'data-icon') el.dataset.icon = v; },
    getAttribute(k) { return k === 'data-icon' ? (el.dataset.icon ?? null) : null; },
    removeAttribute() { },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { },
    focus() { }, blur() { }, click() { },
    closest() { return null; },
    scrollIntoView() { },
    getBoundingClientRect() { return { x: 0, y: 0, width: 1600, height: 900, left: 0, top: 0 }; },
    querySelector() { return makeEl('div'); },
    // the stub cannot parse selectors, so hand back a small pool of stand-ins;
    // callers that index into the result (metas[0], rows[1], ...) keep working
    querySelectorAll() { return Array.from({ length: 8 }, () => makeEl('div')); },
    getContext() { return new RecordingCanvas(300, 150).getContext(); },
    get childElementCount() { return el.children.length; }
  };
  return el;
}
const registry = new Map();
function byId(id) {
  if (!registry.has(id)) {
    const el = id === 'game' || id === 'minimap' || id === 'mentor-portrait'
      ? new RecordingCanvas(id === 'mentor-portrait' ? 256 : id === 'minimap' ? 360 : 1600,
        id === 'minimap' ? 240 : id === 'mentor-portrait' ? 256 : 900)
      : makeEl('div', id);
    if (el.__isCanvas) el.classList = makeEl('div').classList;
    registry.set(id, el);
  }
  return registry.get(id);
}

global.document = {
  createElement: (tag) => (tag === 'canvas' ? new RecordingCanvas(300, 150) : makeEl(tag)),
  getElementById: byId,
  querySelector: (sel) => byId(sel.replace(/^#/, '')),
  querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { },
  body: makeEl('body'),
  documentElement: makeEl('html'),
  hidden: false,
  title: '',
  fonts: { ready: Promise.resolve() }
};
global.window = {
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
  addEventListener() { }, removeEventListener() { },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 8),
  cancelAnimationFrame: (id) => clearTimeout(id),
  localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; })(),
  location: { href: 'file:///smoke' },
  navigator: { userAgent: 'node-smoke', maxTouchPoints: 0, getGamepads: () => [] },
  AudioContext: null
};
global.window.document = global.document;
global.localStorage = global.window.localStorage;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;
try { Object.defineProperty(global, 'navigator', { value: global.window.navigator, configurable: true }); } catch { /* ignore */ }

/* fetch shim: read the shipped JSON tables straight from disk */
global.fetch = async (url) => {
  const clean = String(url).replace(/^\.\//, '').split('?')[0];
  const file = path.join(ROOT, clean);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

/* ----------------------------------------------------------------- boot --- */
console.log('\nPORT OPS SIMULATOR — smoke test\n');
console.log(`node ${process.version} · ${ROOT}\n`);

const { EventBus } = await import('../src/engine/EventBus.js');
const { InputManager } = await import('../src/engine/InputManager.js');
const { SaveManager } = await import('../src/systems/SaveManager.js');
const { SettingsManager } = await import('../src/systems/SettingsManager.js');
const { Localization } = await import('../src/systems/Localization.js');
const { AudioManager } = await import('../src/systems/AudioManager.js');
const { Loader } = await import('../src/systems/Loader.js');
const { Mentor } = await import('../src/education/Mentor.js');
const { Game } = await import('../src/gameplay/Game.js');
const { HUD } = await import('../src/ui/HUD.js');
const { Screens } = await import('../src/ui/Screens.js');
const { DialoguePanel } = await import('../src/ui/DialoguePanel.js');
const { TouchControls } = await import('../src/ui/TouchControls.js');
const { Toaster } = await import('../src/ui/Toast.js');

const bus = new EventBus();
const save = new SaveManager(bus);
save.loadProfile();
const settings = new SettingsManager(save, bus);
const i18n = new Localization(bus);
const audio = new AudioManager(bus, settings);
const input = new InputManager(settings.get('bindings'), bus);
const toaster = new Toaster({ root: byId('toasts'), i18n, bus });
toaster.hook(bus);
const loader = new Loader(bus, i18n);

let data = null;
await step('load every data table', async () => {
  data = await loader.loadAll(() => { });
  if (!data.terminal || !data.machines) throw new Error('core tables missing');
  const langs = Object.keys(i18n.tables);
  if (langs.length !== 3) throw new Error(`expected 3 languages, got ${langs.join(',')}`);
  const lessonCount = (data.lessons?.lessons || []).length;
  const careerCount = (data.missions?.career?.missions || []).length;
  if (lessonCount < 8) throw new Error(`only ${lessonCount} academy lessons`);
  if (careerCount < 9) throw new Error(`only ${careerCount} career missions`);
  notes.push(`${lessonCount} lessons, ${careerCount} career missions, ${Object.keys(data.machines).length} machines`);
});

await step('localize & switch language (en → fr → ar → en)', async () => {
  for (const lang of ['en', 'fr', 'ar', 'en']) {
    i18n.setLanguage(lang);
    if (i18n.t('menu.continue') === 'menu.continue') throw new Error(`missing menu.continue in ${lang}`);
  }
  i18n.setLanguage('ar');
  if (!i18n.isRTL) throw new Error('arabic did not switch to RTL');
  i18n.setLanguage('en');
});

await step('string tables cover every data-i18n key in index.html', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const missing = keys.filter((k) => !(k in i18n.fallback));
  if (missing.length) throw new Error(`missing in en: ${missing.join(', ')}`);
  notes.push(`${keys.length} markup keys resolved`);
});

await step('dialogue table has en + fr + ar for every mentor line', async () => {
  const d = data.dialogue || {};
  const ids = Object.keys(d);
  if (ids.length < 50) throw new Error(`only ${ids.length} mentor lines`);
  const bad = ids.filter((k) => !d[k].en || !d[k].fr || !d[k].ar);
  if (bad.length) throw new Error(`missing translations: ${bad.slice(0, 4).join(', ')}`);
});

await step('every settings label, bind action and codex entry resolves', async () => {
  const BIND = ['forward','reverse','left','right','brake','interact','auxUp','auxDown','auxLeft','auxRight',
    'cycle','horn','recenter','zoomIn','zoomOut','map','mentor','help','pause'];
  const SETTINGS = ['master','music','sfx','engineVolume','warnings','uiVolume','muted','quality','fpsCap',
    'hudScale','cameraShake','vignette','showMinimap','language','showHints','showPrompts','showZones',
    'showMarkers','zoomSmooth','touchControls','leftHanded','invertZoom','bindings','assist','tutorialHints',
    'mentorNudges','autosave','export','import','reset','storage'];
  const LABEL = {
    engineVolume:'settings.engine', uiVolume:'settings.ui', muted:'settings.mute', fpsCap:'settings.fps',
    cameraShake:'settings.shake', touchControls:'settings.touch', bindings:'settings.keybindings',
    assist:'settings.difficulty', tutorialHints:'settings.tutorial'
  };
  const bad = [];
  for (const a of BIND) if (!i18n.fallback[`bind.${a}`]) bad.push(`bind.${a}`);
  for (const k of SETTINGS) if (!i18n.fallback[LABEL[k] || `settings.${k}`]) bad.push(`settings.${k}`);
  for (const g of ['audio','graphics','interface','controls','gameplay','data']) if (!i18n.fallback[`settings.group.${g}`]) bad.push(`settings.group.${g}`);
  for (const k of ['codex.safety','codex.glossary','codex.tab.controls','codex.tab.machines','codex.tab.safety','codex.tab.glossary','codex.tab.about']) if (!i18n.fallback[k]) bad.push(k);
  if (bad.length) throw new Error(`unresolved: ${bad.join(', ')}`);
});

/* --------------------------------------------------------------- systems --- */
const screens = new Screens({
  bus, i18n, settings, saveManager: save, save, machines: data.machines,
  lessons: data.lessons, career: data.missions, audio, game: null, mentor: null, progression: null
});
const mentor = new Mentor({ bus, i18n, save, terminal: null, missions: null, settings });
mentor.lines = data.dialogue;

const game = new Game({
  bus, canvas: byId('game'), i18n, save, settings, audio, screens,
  machines: data.machines, layout: data.terminal, lessons: data.lessons, career: data.missions,
  mentor, input
});
screens.game = game;
screens.mentor = mentor;
screens.progression = game.progression;

await step('create the world (terminal, terrain, renderer, 5 machines)', async () => {
  const world = await game.createWorld();
  if (!world.terminal.containers.length) throw new Error('no containers seeded');
  if (game.vehicles.length !== 5) throw new Error(`expected 5 machines, got ${game.vehicles.length}`);
  notes.push(`${world.terminal.containers.length} containers, ${world.terminal.slots.size} yard slots`);
});

const hud = new HUD({
  bus, i18n, settings, terminal: game.world.terminal, save, missions: game.missionManager,
  mentor, audio, machineSpecs: data.machines
});
hud.mount();
hud.setTerrain(game.world.terrain);
game.hud = hud;

const dialogue = new DialoguePanel({
  layer: byId('dialogue-layer'), mentor, i18n, bus,
  terminal: game.world.terminal, missions: game.missionManager, settings, audio
});
dialogue.ctxProvider = () => ({ vehicle: game.player, mission: game.missionManager.active });
const touch = new TouchControls({ root: byId('touch'), bus, settings, i18n, input, terminal: game.world.terminal });
touch.mount();
touch.attachGestures(byId('game'), game.world.camera, input);
game.touch = touch;

await step('mentor speaks and answers every topic', async () => {
  mentor.onSpeak = (p) => dialogue.speak(p);
  mentor.say(['mentor.welcome', 'mentor.welcome2'], [], { force: true });
  if (!dialogue.isOpen) throw new Error('dialogue did not open');
  dialogue.hide();
  const ctx = { vehicle: game.player, mission: null, keyLabel: () => 'W' };
  for (const t of mentor.topics(ctx)) {
    const answer = mentor.answer(t.id, ctx);
    if (!answer || answer === `mentor.ask${t.id}`) throw new Error(`no answer for topic ${t.id}`);
  }
});

await step('HUD renders mission state, controls legend and minimap', async () => {
  game.enterPlay({ mode: 'academy', machine: 'forklift', mission: data.lessons.lessons[1] });
  hud.update(0.016, game._buildContext(game.player, 0.016));
  hud.drawMinimap(game._buildContext(game.player));
  if (!game.missionManager.active) throw new Error('mission did not start');
});

/* ------------------------------------------------------------- driving --- */
function driveProfile(t) {
  // 0-2 s forward, then steering, then a stop
  return {
    throttle: t < 2 ? 1 : t < 4 ? 0.7 : 0,
    steer: t > 1.5 && t < 3.5 ? (Math.sin(t * 2) > 0 ? -1 : 1) : 0,
    brake: t >= 4
  };
}
function run(seconds, controls, label) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    game.update(1 / 60);
    if (controls) {
      const c = typeof controls === 'function' ? controls(i / 60) : controls;
      game.player.update(1 / 60, { cycle: false, interact: false, horn: false, ...c });
    }
    if (i % 15 === 0) game.render(1, 1 / 60, false);
  }
  return label;
}

await step('drive the forklift for 6 simulated seconds', async () => {
  const v = game.player;
  const start = { x: v.x, y: v.y };
  run(6, (t) => driveProfile(t));
  const moved = Math.hypot(v.x - start.x, v.y - start.y);
  if (moved < 2) throw new Error(`machine barely moved (${moved.toFixed(2)} m)`);
  if (!Number.isFinite(v.x)) throw new Error('position went non-finite');
  notes.push(`drove ${moved.toFixed(1)} m, speed ${v.speed.toFixed(2)} m/s`);
});

/** Park `v` so its attachment point sits `gap` metres short of `cargo`,
 *  facing +X — exactly what a player does by lining the forks up. */
function parkAt(v, cargo, gap = 0.4) {
  v.angle = 0;
  v.speed = 0; v.vx = 0; v.vy = 0;
  const save = { x: v.x, y: v.y };
  v.x = 0; v.y = 0;
  const local = v.pickupPoint();
  v.x = save.x; v.y = save.y;
  v.x = cargo.x - local.x - gap;
  v.y = cargo.y - local.y;
  return v;
}

await step('forklift lifts a pallet and sets it down', async () => {
  const T = game.world.terminal;
  const v = game.player;
  // pick an apron pallet (not one strapped to a trailer, not one already held)
  const pallet = T.pallets.find((p) => !p.hold && !p.truck && !p.blocked) || T.pallets.find((p) => !p.truck) || T.pallets[0];
  if (!pallet) throw new Error('no pallets in the world');
  parkAt(v, pallet, 0.5);
  v.forkHeight = 0.12;
  const pick = game.world.attachments.pick(v);
  if (!pick.ok) throw new Error(`pick refused: ${pick.code} — ${pick.message}`);
  if (v.load !== pallet) throw new Error('pallet not attached');
  // reverse away from the racking, then creep forward until there is a clear
  // patch to set the load down on (exactly what the player does with the ghost)
  for (let i = 0; i < 90; i++) v.update(1 / 60, { throttle: -0.7, steer: 0, brake: false });
  v.forkHeight = 0.35;
  let place = game.world.attachments.place(v);
  for (let k = 0; k < 12 && !place.ok; k++) {
    v.x += Math.cos(v.angle) * 1.0;
    v.y += Math.sin(v.angle) * 1.0;
    place = game.world.attachments.place(v);
  }
  if (!place.ok) throw new Error(`place refused: ${place.code} — ${place.message}`);
  if (v.load) throw new Error('load still attached after release');
  notes.push('pallet handled end-to-end');
});

await step('reach stacker picks and stacks a container', async () => {
  game.setPlayer('reachstacker');
  const v = game.player;
  const T = game.world.terminal;
  const loose = T.containers.filter((c) => !c.slot && !c.hold && !c.vessel && c.kind === 'container');
  const box = loose[0];
  if (!box) throw new Error('no loose containers on the apron');
  v.spreaderSize = box.size;
  v.boomAngle = 0.05;
  v.boomExtend = 0;
  parkAt(v, box, 0.8);
  const pick = game.world.attachments.pick(v);
  if (!pick.ok) throw new Error(`reach stacker refused: ${pick.code} — ${pick.message}`);
  // find a free slot and lower the box in
  const slot = T.nearestFreeSlot(box.x, box.y, box.size);
  parkAt(v, { x: slot.x, y: slot.y }, 0.8);
  const place = game.world.attachments.place(v);
  if (!place.ok) throw new Error(`stack refused: ${place.code} — ${place.message}`);
  notes.push(`container ${box.id} stacked into ${box.slot?.blockId || '?'}`);
});

await step('RTG trolley, hoist and spreader respond', async () => {
  game.setPlayer('rtg');
  const v = game.player;
  const start = v.hoistHeight;
  for (let i = 0; i < 60; i++) v.update(1 / 60, { throttle: 0, steer: 0, brake: true, auxDown: true });
  if (v.hoistHeight === start) throw new Error('hoist did not move');
  const size = v.spreaderSize;
  v.update(1 / 60, { cycle: true, brake: true });
  if (v.spreaderSize === size) throw new Error('spreader did not cycle');
});

await step('harbour crane boom and hook respond within limits', async () => {
  game.setPlayer('harborcrane');
  const v = game.player;
  for (let i = 0; i < 240; i++) v.update(1 / 60, { auxDown: true, brake: true });
  if (v.boomAngle < v.spec.luffMin - 1e-6) throw new Error(`boom below luffMin (${v.boomAngle})`);
  const cap = v.currentCapacity();
  if (!(cap > 0 && cap < 200)) throw new Error(`implausible capacity ${cap}`);
});

await step('yard trailers are parked clear of obstacles', async () => {
  const T = game.world.terminal;
  if (!T.trailers?.length) throw new Error('no yard trailers in the world');
  for (const t of T.trailers) {
    const hits = T.collision.queryRect({ x: t.x - t.length / 2, y: t.y - t.width / 2, w: t.length, h: t.width }, [])
      .filter((b) => b.trailer !== t && ['building', 'fence', 'prop', 'vehicle'].includes(b.kind));
    if (hits.length) throw new Error(`${t.id} overlaps ${hits.map((h) => h.id).join(', ')}`);
  }
  notes.push(`${T.trailers.length} yard trailers parked`);
});

await step('tractor couples to a trailer and tows it', async () => {
  const T = game.world.terminal;
  game.setPlayer('tractor');
  const v = game.player;
  if (typeof v.toggleCoupling !== 'function') throw new Error('tractor has no coupling');
  // back the unit up to the first trailer's kingpin
  const trailer = T.trailers[0];
  const back = trailer.length / 2 + 1.1 - v.trailerOffset;
  v.angle = trailer.angle;
  v.x = trailer.x + Math.cos(v.angle) * back;
  v.y = trailer.y + Math.sin(v.angle) * back;
  v.speed = 0;
  v.toggleCoupling();
  if (!v.coupled || v.trailer !== trailer) throw new Error('coupling failed');
  if (trailer.towedBy !== v.id) throw new Error('trailer does not know its tractor');
  const before = { x: trailer.x, y: trailer.y };
  for (let i = 0; i < 180; i++) { v.update(1 / 60, { throttle: 1, steer: 0, brake: false }); T.update(1 / 60, {}); }
  const moved = Math.hypot(trailer.x - before.x, trailer.y - before.y);
  if (moved < 3) throw new Error(`trailer did not follow the tractor (${moved.toFixed(2)} m)`);
  v.toggleCoupling();
  if (v.coupled) throw new Error('uncoupling failed');
  notes.push(`towed a trailer ${moved.toFixed(1)} m`);
});

await step('a crane sets a container down on a trailer deck', async () => {
  const T = game.world.terminal;
  const trailer = T.trailers[1];
  game.setPlayer('harborcrane');
  const v = game.player;
  // lift the top container of a yard column with the real pick path
  const cargo = T.containers.find((c) => c.slot && !c.hold && !c.trailer
    && !(T.slotAt(c.slot.blockId, c.slot.bay, c.slot.row, c.slot.tier + 1)?.container));
  if (!cargo) throw new Error('no liftable container in the yard');
  v.hookDrop = 0.2;
  v.boomAngle = 0.05;
  parkAt(v, cargo, 0.8);
  const pick = game.world.attachments.pick(v);
  if (!pick.ok) throw new Error(`crane pick refused: ${pick.code} — ${pick.message}`);
  // park so the hook hangs over the middle of the trailer deck
  const probe = (() => { const s = { x: v.x, y: v.y }; v.x = 0; v.y = 0; const p = v.pickupPoint(); v.x = s.x; v.y = s.y; return p; })();
  v.x = trailer.x - probe.x; v.y = trailer.y - probe.y;
  const res = game.world.attachments.place(v);
  if (!res.ok) throw new Error(`trailer placement refused: ${res.code} — ${res.message}`);
  if (trailer.cargo !== cargo) throw new Error('container not linked to the trailer');
  notes.push('container loaded onto trailer deck');
});

/* --------------------------------------------------------- mission flow --- */
await step('academy lesson completes and produces a scored debrief', async () => {
  const lesson = data.lessons.lessons[0];
  game.startLesson(lesson.id);
  const m = game.missionManager.active;
  // satisfy every objective directly, then let the manager notice
  for (const o of m.objectives) o.state = 'done';
  m.elapsed = 12;
  m.liftedIds.add('test-1');
  m.placedIds.add('test-1');
  m.deliveredIds.add('test-1');
  game.missionManager.update(1 / 60, game._buildContext(game.player, 1 / 60));
  if (m.status !== 'completed') throw new Error(`lesson status is ${m.status}`);
  if (!game.lastResult) throw new Error('no result produced');
  const r = game.lastResult.result;
  if (!(r.score >= 0 && r.score <= 100)) throw new Error(`score out of range: ${r.score}`);
  for (const k of ['safety', 'accuracy', 'equipment', 'time', 'efficiency']) {
    if (!(k in r.breakdown)) throw new Error(`no ${k} in breakdown`);
  }
  if (!(save.profile.missions[lesson.id]?.completed)) throw new Error('progress was not saved');
  notes.push(`debrief score ${r.score} (${Object.entries(r.breakdown).map(([k, v]) => `${k} ${v}`).join(', ')})`);
});

await step('career mission awards XP/credits and can fail on a capsize-free timeout', async () => {
  const def = data.missions.career.missions[2];
  const xpBefore = save.profile.xp;
  game.startCareer(def.id);
  const m = game.missionManager.active;
  for (const o of m.objectives) o.state = 'done';
  m.elapsed = 20;
  game.missionManager.update(1 / 60, game._buildContext(game.player, 1 / 60));
  if (m.status !== 'completed') throw new Error(`career mission is ${m.status}`);
  if (save.profile.xp <= xpBefore) throw new Error('no XP awarded');

  // now a failure path: blow the clock
  game.startCareer(def.id);
  const m2 = game.missionManager.active;
  m2.elapsed = (m2.timeLimit ?? 300) + 1;
  game.missionManager.update(1 / 60, game._buildContext(game.player, 1 / 60));
  if (m2.status !== 'failed') throw new Error(`expected failure, got ${m2.status}`);
  if (m2.failReason !== 'time') throw new Error(`wrong fail reason: ${m2.failReason}`);
});

await step('free operations starts, switches machines and posts job cards', async () => {
  game.startFree({ machine: 'reachstacker', shift: 'yard', jobs: true, traffic: true, safety: true });
  if (game.mode !== 'free') throw new Error('mode not set');
  if (!game.canSwitch) throw new Error('machine switching should be allowed in free ops');
  game.setPlayer('rtg');
  if (game.player.type !== 'rtg') throw new Error('machine switch failed');
  const jobs = data.missions.freeJobs;
  if (!jobs?.length) throw new Error('no job board tasks');
  notes.push(`${jobs.length} job board tasks available`);
});

await step('pause / resume / menu transitions are clean', async () => {
  game.startFree({ machine: 'forklift' });
  game.pause();
  if (game.state !== 'paused') throw new Error('pause failed');
  game.resume();
  if (game.state !== 'playing') throw new Error('resume failed');
  game.toMenu();
  if (game.state !== 'menu') throw new Error('toMenu failed');
});

await step('screens render: menu, career list, academy list, free setup, settings, codex', async () => {
  game.state = 'menu';
  for (const id of ['menu', 'list', 'free', 'settings', 'codex']) {
    screens.showScreen(id);
  }
  screens.openList('career');
  screens.renderLists();
  screens.openList('academy');
  screens.renderLists();
  screens.openBrief(data.lessons.lessons[0].id);
  screens.closeOverlay();
  screens.openBrief(data.missions.career.missions[0].id);
  screens.closeOverlay();
  screens.openPause();
  screens.closeOverlay();
});

await step('achievements, levels and unlocks behave', async () => {
  const prog = game.progression;
  prog.checkAchievements({});
  if (!save.profile.achievements['first-shift']) throw new Error('first-shift achievement missing');
  const lvl = save.addXp(20000);
  if (lvl < 5) throw new Error(`levelling looks wrong (level ${lvl})`);
  save.unlock('harborcrane');
  if (!save.has('harborcrane')) throw new Error('unlock failed');
  save.profile.xp = 0;
  save.saveProfile(true);
});

/* ------------------------------------------------------------- export ----- */
await step('save export / import round-trips', async () => {
  const dump = save.exportAll();
  if (typeof dump !== 'string') throw new Error('exportAll should return a JSON string');
  const parsed = JSON.parse(dump);
  if (parsed.app !== 'port-ops-simulator') throw new Error('wrong export header');
  save.profile.credits = 1;
  const res = save.importAll(dump);
  if (res?.ok !== true) throw new Error('import failed');
  if (save.profile.credits === 1) throw new Error('import did not restore data');
});

await step('render frames from the live game state', async () => {
  game.startFree({ machine: 'reachstacker' });
  const cam = game.world.camera;
  const v = game.player;
  cam.snapTo(v.x, v.y, 5.2);
  for (let i = 0; i < 120; i++) { game.update(1 / 60); game.render(1, 1 / 60, false); }
  // visual QA lives in tools/scene-shot.mjs (it rasterises through resvg);
  // here we only assert the render path ran without throwing
  if (!byId('game').__ops.length) throw new Error('renderer produced no draw calls');
  notes.push(`${byId('game').__ops.length} draw calls in the last frame`);
});

/* --------------------------------------------------------------- report --- */
const ms = Math.round(performance.now() - t0);
console.log('');
for (const n of notes) console.log(`  · ${n}`);
console.log(`\n${failures.length ? '\u2717 FAIL' : '\u2713 PASS'} — ${failures.length} failed, ${ms} ms\n`);
process.exit(failures.length ? 1 : 0);
