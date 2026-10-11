#!/usr/bin/env node
/**
 * shots.mjs — real browser screenshots of the running game.
 *
 * Launches the bundled headless Chromium through puppeteer-core, drives the
 * actual UI (menu, lists, settings, codex, gameplay, mentor) and writes PNGs.
 * Unlike scene-shot.mjs this captures the *whole product*: HTML/CSS chrome
 * plus the canvas world.
 *
 *   node tools/shots.mjs [outDir] [--port 4173]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const PPX = process.env.PPX_MODULES || '/tmp/pptr';
const LIBDIR = process.env.CHROMIUM_LIBS || '/tmp/chromium-libs/lib';

const puppeteer = require(join(PPX, 'node_modules', 'puppeteer-core'));
const chromium = require(join(PPX, 'node_modules', '@sparticuz', 'chromium', 'build', 'index.js'));
const chromiumPkg = chromium.default || chromium;

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) || 'preview/shots');
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const W = 1600, H = 900;
const GROUP = args.includes('--play') ? 'play' : args.includes('--ui') ? 'ui' : args.includes('--mentor') ? 'mentor' : args.includes('--touch') ? 'touch' : 'all';
const want = (g) => GROUP === 'all' || GROUP === g;

mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------ dev server -- */
async function ensureServer() {
  try {
    const r = await fetch(BASE, { method: 'HEAD' });
    if (r.ok || r.status === 405) return null;
  } catch (e) { /* not up */ }
  const srv = spawn(process.execPath, ['tools/serve.js'], {
    cwd: resolve(outDir, '..', '..'), stdio: 'ignore', detached: true
  });
  srv.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { const r = await fetch(BASE); if (r.ok) return srv; } catch (e) { /* retry */ }
  }
  throw new Error('dev server did not start');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = await ensureServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || (await chromiumPkg.executablePath()),
    args: [
      ...chromiumPkg.args,
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio'
    ],
    env: { ...process.env, LD_LIBRARY_PATH: LIBDIR },
    headless: true,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }
  });

  const logs = [];
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  const shot = async (name) => {
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(`  ${name}.png`);
    return file;
  };

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  // wait for boot to finish and the menu to appear
  await page.waitForFunction(
    () => window.__portops?.game?.state !== undefined && !document.getElementById('screen-boot')?.classList.contains('show'),
    { timeout: 45000 }
  ).catch(() => { /* fall through to a manual wait */ });
  await wait(900);

  if (want('ui')) {
  /* ------------------------------------------------------------- menu ---- */
  await page.evaluate(() => window.__portops.screens.showScreen('menu'));
  await wait(600);
  await shot('01-main-menu');

  /* ----------------------------------------------------------- career ---- */
  await page.evaluate(() => window.__portops.screens.dispatch('career'));
  await wait(600);
  await shot('02-career-list');

  /* ---------------------------------------------------------- academy ---- */
  await page.evaluate(() => window.__portops.screens.dispatch('academy'));
  await wait(500);
  await shot('03-academy-list');

  /* ------------------------------------------------------------- brief --- */
  await page.evaluate(() => {
    const app = window.__portops;
    const first = app.game.lessons.lessons[0];
    app.screens.openBrief(first.id);
  });
  await wait(650);
  await shot('04-briefing');

  /* ------------------------------------------------------------ free ----- */
  await page.evaluate(() => {
    window.__portops.screens.closeOverlay();
    window.__portops.screens.dispatch('free');
  });
  await wait(600);
  await shot('05-free-operations');

  /* --------------------------------------------------------- settings ---- */
  await page.evaluate(() => window.__portops.screens.dispatch('settings'));
  await wait(600);
  await shot('06-settings');

  /* ------------------------------------------------------------ codex ---- */
  await page.evaluate(() => {
    const s = window.__portops.screens;
    s.codexReturn = 'settings';
    s.showScreen('codex');
  });
  await wait(500);
  await shot('07-codex-controls');
  await page.evaluate(() => { window.__portops.screens.codexTab = 'machines'; window.__portops.screens.renderCodex(); });
  await wait(450);
  await shot('08-codex-machines');

  }

  if (want('touch')) {
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true });
    await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__portops?.game?.state !== undefined && !document.getElementById('screen-boot')?.classList.contains('show'), { timeout: 45000 }).catch(() => {});
    await wait(1200);
    await shot('20-touch-menu');
    await page.evaluate(() => {
      const app = window.__portops;
      app.screens.showScreen('none');
      app.game.startFree({ machine: 'forklift', shift: 'open', jobs: true, traffic: true, safety: true, overlays: true });
    });
    await wait(2200);
    await page.evaluate(() => window.__portops.dialogue.hide());
    await wait(600);
    await shot('21-touch-forklift');
    await page.evaluate(() => { const d = window.__portops.dialogue; d.hide(); d.ask(); });
    await wait(900);
    await shot('22-touch-mentor');
    await page.evaluate(() => { const a = window.__portops; a.dialogue.hide(); a.game.setPlayer('reachstacker'); });
    await wait(1500);
    await shot('23-touch-reachstacker');
  }

  if (want('mentor')) {
    await page.evaluate(() => {
      const app = window.__portops;
      app.screens.showScreen('none');
      app.game.startFree({ machine: 'forklift', shift: 'open', jobs: true, traffic: true, safety: true, overlays: true });
    });
    await wait(1800);
    await page.evaluate(() => {
      const d = window.__portops.dialogue;
      d.hide();
      d.ask();
    });
    await wait(900);
    await shot('18-mentor-ask');
    await page.evaluate(() => {
      const d = window.__portops.dialogue;
      const t = d.mentor.topics(d.ctxProvider());
      d.askTopic((t[1] || t[0]).id);
    });
    await wait(900);
    await shot('14-mentor-dialogue');
  }

  if (want('play')) {
  /* -------------------------------------------------------- gameplay ----- */
  const startFree = async (machine) => {
    await page.evaluate((m) => {
      const app = window.__portops;
      app.screens.showScreen('none');
      app.game.startFree({ machine: m, shift: 'open', jobs: true, traffic: true, safety: true, overlays: true });
    }, machine);
    await wait(1500);
    await page.evaluate(() => window.__portops.dialogue.hide());
    await wait(300);
  };

  await startFree('forklift');
  await shot('09-forklift-hud');

  // drive a little so the machine is under way and markers resolve
  await page.evaluate(() => {
    const app = window.__portops;
    app.input.setVirtual('forward', true);
  });
  await wait(1400);
  await page.evaluate(() => window.__portops.input.setVirtual('forward', false));
  await wait(400);
  await shot('10-forklift-driving');

  /* ------------------------------------------------------ reach stacker -- */
  await page.evaluate(() => {
    const app = window.__portops;
    app.game.setPlayer('reachstacker');
  });
  await wait(1200);
  await shot('11-reach-stacker');

  /* --------------------------------------------------------------- RTG --- */
  await page.evaluate(() => window.__portops.game.setPlayer('rtg'));
  await page.evaluate(() => window.__portops.dialogue.hide());
  await wait(1200);
  await shot('12-rtg-crane');

  /* ------------------------------------------------- harbour crane ------- */
  await page.evaluate(() => window.__portops.game.setPlayer('harborcrane'));
  await wait(1500);
  await shot('13-harbour-crane');

  /* ------------------------------------------------------------ mentor --- */
  await page.evaluate(() => window.__portops.dialogue.open?.('objective') || window.__portops.dialogue.toggle());
  await wait(900);
  await shot('14-mentor-dialogue');
  await page.evaluate(() => window.__portops.dialogue.hide());

  /* --------------------------------------------------------------- pause -- */
  await page.evaluate(() => window.__portops.screens.openPause());
  await wait(700);
  await shot('15-pause');
  await page.evaluate(() => window.__portops.screens.closeOverlay());
  await wait(400);

  /* ------------------------------------------------------------ Arabic --- */
  await page.evaluate(async () => {
    await window.__portops.settings.set('language', 'ar');
  });
  await wait(900);
  await page.evaluate(() => window.__portops.game.toMenu());
  await wait(900);
  await shot('16-arabic-rtl');

  /* --------------------------------------------------------------- wide --- */
  await page.evaluate(async () => {
    await window.__portops.settings.set('language', 'en');
  });
  await wait(700);
  await page.evaluate(() => {
    const app = window.__portops;
    app.screens.showScreen('none');
    app.game.startFree({ machine: 'rtg', shift: 'yard', jobs: true, traffic: true, safety: true, overlays: false });
  });
  await wait(1800);
  await page.evaluate(() => { const c = window.__portops.world.camera; c.targetZoom = 3.4; });
  await wait(900);
  await shot('17-terminal-wide');

  }

  writeFileSync(join(outDir, 'console.log'), logs.join('\n') || '(no console output)');
  await browser.close();
  if (srv) process.kill(-srv.pid, 'SIGTERM');

  const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  console.log(`\nconsole: ${logs.length} messages, ${errors.length} errors`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  console.log(`\nshots written to ${outDir}`);
  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
