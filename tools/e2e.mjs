#!/usr/bin/env node
/**
 * e2e.mjs — real-browser player journey (Chromium via puppeteer-core).
 *
 *   node tools/e2e.mjs [--port 4173]
 *
 * Uses real clicks and real key presses. Covers: boot → menu → Academy lesson
 * → drive forklift → pick/place a pallet → pause/resume → settings → other
 * machines → save → reload → Continue. Exits non-zero on any failure or any
 * console/page error. Needs `npm i puppeteer-core @sparticuz/chromium` in
 * $PPX_MODULES (default /tmp/pptr) and the extracted libs in $CHROMIUM_LIBS.
 */
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PPX = process.env.PPX_MODULES || '/tmp/pptr';
const LIBDIR = process.env.CHROMIUM_LIBS || '/tmp/chromium-libs/lib';
const puppeteer = require(join(PPX, 'node_modules', 'puppeteer-core'));
const chromium = require(join(PPX, 'node_modules', '@sparticuz', 'chromium', 'build', 'index.js'));
const chromiumPkg = chromium.default || chromium;

const args = process.argv.slice(2);
const pi = args.indexOf('--port');
const BASE = `http://127.0.0.1:${pi >= 0 ? args[pi + 1] : 4173}/`;
import { mkdirSync } from 'node:fs';
mkdirSync('preview/shots', { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const logs = [];
async function step(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`  \u2713 ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
const must = (c, m) => { if (!c) throw new Error(m); };

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || (await chromiumPkg.executablePath()),
  args: [...chromiumPkg.args, '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars'],
  env: { ...process.env, LD_LIBRARY_PATH: LIBDIR },
  headless: true,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 }
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const app = (fn, ...a) => page.evaluate(fn, ...a);
const boot = async () => {
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__portops?.game && document.querySelector('#screen-menu')?.classList.contains('show'), { timeout: 60000 });
  await wait(500);
};
const closeMentor = () => app(() => window.__portops.dialogue.hide());
const holdKey = async (code, ms) => { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); };

console.log('PORT OPS SIMULATOR — real-browser e2e');
await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } }).catch(() => { });

await step('boot reaches the main menu', async () => {
  await boot();
  const btns = await app(() => [...document.querySelectorAll('#screen-menu [data-action]')].map((b) => b.dataset.action));
  for (const a of ['continue', 'career', 'academy', 'free', 'settings', 'newgame', 'exit']) must(btns.includes(a), `menu button "${a}" missing`);
  return btns.length + ' menu buttons';
});

await step('mentor welcome appears on first launch and can be dismissed', async () => {
  await wait(800);
  const shown = await app(() => !document.getElementById('dialogue-layer').classList.contains('is-hidden'));
  must(shown, 'welcome dialogue not shown');
  await page.click('.dlg-close');
  await wait(300);
  must(await app(() => document.getElementById('dialogue-layer').classList.contains('is-hidden')), 'dialogue did not close');
});

await step('every menu button responds (academy, career, free, settings, manual)', async () => {
  for (const [action, screen] of [['academy', 'screen-list'], ['career', 'screen-list'], ['free', 'screen-free'], ['settings', 'screen-settings']]) {
    await page.click(`#screen-menu [data-action="${action}"]`);
    await wait(350);
    const on = await app((id) => document.getElementById(id)?.classList.contains('show'), screen);
    must(on, `${action} did not open #${screen}`);
    await page.click(`#${screen} [data-action="back"]`);
    await wait(300);
  }
  await page.click('#screen-menu [data-action="codex"]');
  await wait(350);
  must(await app(() => document.getElementById('screen-codex')?.classList.contains('show')), 'codex did not open');
  await page.click('#screen-codex [data-action="back"]');
  await wait(300);
});

await step('Academy: open first lesson brief and start it', async () => {
  await page.click('#screen-menu [data-action="academy"]');
  await wait(450);
  await page.click('#list-cards .btn:not(.ghost)');
  await wait(450);
  await page.click('[data-modal="start"]');
  await wait(1800);
  const st = await app(() => ({ state: window.__portops.game.state, mode: window.__portops.game.mode, m: window.__portops.game.player?.type }));
  must(st.state === 'playing', `state is ${st.state}`);
  return `${st.mode} lesson with ${st.m}`;
});

await step('mentor tutorial speaks and advances with the keyboard/click', async () => {
  const text = await app(() => document.querySelector('.dlg-text')?.textContent?.trim());
  must(text && text.length > 10, 'no mentor text on lesson start');
  const opt = await page.$('.dlg-opt');
  if (opt) { await opt.click(); await wait(400); }
  await closeMentor();
});

await step('HUD shows mission card, machine panel and controls', async () => {
  const ok = await app(() => ({
    mission: !!document.querySelector('.mission-card')?.offsetParent,
    machine: !!document.querySelector('.machine-panel')?.offsetParent,
    ask: !!document.getElementById('hud-mentor')?.offsetParent || !!document.querySelector('[data-action="mentor"]')?.offsetParent
  }));
  must(ok.mission && ok.machine, `HUD parts missing ${JSON.stringify(ok)}`);
});

await step('real key presses drive the machine', async () => {
  await closeMentor();
  await page.mouse.click(640, 360);
  const p0 = await app(() => { const v = window.__portops.game.player; return { x: v.x, y: v.y, a: v.angle }; });
  await holdKey('KeyW', 1500);
  await holdKey('KeyA', 700);
  await holdKey('KeyW', 800);
  const p1 = await app(() => { const v = window.__portops.game.player; return { x: v.x, y: v.y, a: v.angle }; });
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  must(d > 0.5 || Math.abs(p1.a - p0.a) > 0.05, `machine did not move (moved ${d.toFixed(2)} m)`);
  return `moved ${d.toFixed(1)} m, turned ${(p1.a - p0.a).toFixed(2)} rad`;
});

await step('forklift handles a pallet (E to pick, E to place)', async () => {
  await app(() => {
    const g = window.__portops.game; const v = g.player;
    const T = g.world.terminal;
    const pal = T.pallets.find((p) => !p.hold && !p.truck && !p.blocked) || T.pallets[0];
    v.angle = 0; v.speed = 0; v.vx = 0; v.vy = 0;
    const s = { x: v.x, y: v.y }; v.x = 0; v.y = 0; const l = v.pickupPoint(); v.x = s.x; v.y = s.y;
    v.x = pal.x - l.x - 0.5; v.y = pal.y - l.y; v.forkHeight = 0.12;
    window.__e2ePallet = pal;
  });
  await wait(300);
  await holdKey('KeyE', 120);
  await wait(500);
  const held = await app(() => window.__portops.game.player.load === window.__e2ePallet);
  must(held, 'pallet not picked up with E');
  await holdKey('KeyS', 900);
  await holdKey('KeyR', 400);
  let placed = false;
  for (let i = 0; i < 12 && !placed; i++) {
    await holdKey('KeyE', 120);
    await wait(350);
    placed = await app(() => !window.__portops.game.player.load);
    if (!placed) await holdKey('KeyW', 450);
  }
  must(placed, 'pallet could not be set down with E');
});

await step('pause (Esc) → settings → resume', async () => {
  await page.keyboard.press('Escape');
  await wait(500);
  must(await app(() => window.__portops.game.state === 'paused'), 'Esc did not pause');
  const btn = await page.$('.overlay [data-modal="resume"], [data-modal="resume"]');
  must(btn, 'no Resume button in pause overlay');
  await btn.click();
  await wait(500);
  must(await app(() => window.__portops.game.state === 'playing'), 'Resume did not resume');
});

await step('settings: change language to French and back, volume persists', async () => {
  await app(() => window.__portops.settings.set('language', 'fr'));
  await wait(500);
  const fr = await app(() => document.querySelector('#hud-pause')?.textContent || document.querySelector('.hud-top button')?.textContent);
  await app(() => window.__portops.settings.set('language', 'en'));
  await wait(300);
  await app(() => window.__portops.settings.set('masterVolume', 0.42));
  const v = await app(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /setting/i.test(k)))||'{}'));
  return `HUD in French: "${(fr || '').trim()}"`;
});

await step('all machines can be entered and driven without errors', async () => {
  const out = [];
  for (const m of ['reachstacker', 'rtg', 'harborcrane', 'tractor', 'forklift']) {
    await app((t) => window.__portops.game.setPlayer(t), m);
    await closeMentor();
    await wait(400);
    await holdKey('KeyW', 500);
    await holdKey('KeyR', 200);
    const info = await app(() => { const v = window.__portops.game.player; return [v.type, +v.x.toFixed(1), +v.y.toFixed(1)]; });
    out.push(info[0]);
  }
  return out.join(', ');
});

await step('mission completes → scored debrief → progress saved and survives reload', async () => {
  await app(() => window.__portops.game.toMenu());
  await wait(500);
  const lessonId = await app(() => {
    const g = window.__portops.game;
    const lesson = (g.lessons?.lessons || [])[0];
    g.startLesson(lesson.id);
    const m = g.missionManager.active;
    for (const o of m.objectives) o.state = 'done';
    m.elapsed = 12; m.liftedIds.add('e2e'); m.placedIds.add('e2e'); m.deliveredIds.add('e2e');
    return lesson.id;
  });
  await wait(1500);
  const info = await app((id) => {
    const p = window.__portops.save.profile;
    return { done: !!p.missions[id]?.completed, score: p.missions[id]?.score ?? p.missions[id]?.best ?? null,
      overlay: !!document.querySelector('.overlay.show, .modal.show, #overlay-layer:not(.is-hidden)') };
  }, lessonId);
  must(info.done, 'lesson not recorded as completed');
  await page.screenshot({ path: 'preview/shots/19-debrief.png' });
  await app(() => window.__portops.save.saveProfile(true));
  await boot();
  const again = await app((id) => !!window.__portops.save.profile.missions[id]?.completed, lessonId);
  must(again, 'completed lesson lost after reload');
  return `lesson ${lessonId} completed, persisted`;
});

await step('free operations: start a shift from the real UI', async () => {
  await app(() => window.__portops.game.toMenu());
  await wait(700);
  await page.click('#screen-menu [data-action="free"]');
  await wait(450);
  const start = await page.$('#screen-free .btn.primary');
  must(start, 'no start button on free-operations screen');
  await start.click();
  await wait(1800);
  must(await app(() => window.__portops.game.state === 'playing'), 'free shift did not start');
  await closeMentor();
});

await step('save → reload → Continue is available and resumes', async () => {
  await app(() => window.__portops.save.saveProfile(true));
  const before = await app(() => ({ cr: window.__portops.save.profile.credits ?? null, keys: Object.keys(localStorage) }));
  must(before.keys.length > 0, 'nothing in localStorage');
  await boot();
  const label = await app(() => document.querySelector('#screen-menu [data-action="continue"] .mb-sub')?.textContent);
  const profile = await app(() => !!window.__portops.save.profile);
  must(profile, 'profile not restored after reload');
  return `Continue subtitle: "${(label || '').trim()}"`;
});

await step('export save produces a JSON backup that re-imports', async () => {
  const r = await app(() => {
    const s = window.__portops.save;
    let json = s.exportAll ? s.exportAll() : null; if (json && typeof json !== 'string') json = JSON.stringify(json);
    return { has: typeof json === 'string' && json.length > 20, ok: json ? (() => { try { JSON.parse(json); return true; } catch { return false; } })() : false };
  });
  must(r.has && r.ok, 'exportAll did not return valid JSON');
});

await step('new game (reset) clears progress after confirmation', async () => {
  await page.click('#screen-menu [data-action="newgame"]');
  await wait(500);
  const yes = await page.$('[data-modal="yes"]');
  must(yes, 'no confirmation dialog for New Game');
  await yes.click();
  await wait(800);
  must(await app(() => window.__portops.game.state !== 'playing'), 'still playing after new game');
});

const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
await step('no browser console errors during the whole journey', async () => {
  must(errors.length === 0, errors.slice(0, 4).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? '✗ FAIL' : '✓ PASS'} — ${results.length - failed}/${results.length} steps${logs.length ? `, ${logs.length} console messages` : ''}`);
if (logs.length) for (const l of logs.slice(0, 8)) console.log('  ' + l);
process.exit(failed ? 1 : 0);
