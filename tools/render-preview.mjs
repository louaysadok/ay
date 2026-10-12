#!/usr/bin/env node
/**
 * render-preview.mjs — dev-only harness (no game dependency).
 *
 * Renders game art / full scenes through the headless Canvas2D recorder
 * (tools/svgcanvas.mjs) into SVG, then rasterises to PNG when a rasteriser is
 * available. Used to visually verify procedural sprites and the terminal
 * renderer on machines without a browser.
 *
 *   node tools/render-preview.mjs [outDir]
 */
import { installDOM, canvasToSvg, RecordingCanvas } from './svgcanvas.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'preview');
fs.mkdirSync(OUT, { recursive: true });

installDOM({ width: 1920, height: 1080 });

const rasteriser = (() => {
  const paths = [process.env.PPX_MODULES, '/tmp/pptr/package.json', path.resolve('package.json')].filter(Boolean);
  for (const p of paths) {
    try {
      const req = createRequire(p.endsWith('.json') ? p : path.join(p, 'package.json'));
      return req('@resvg/resvg-js');
    } catch { /* try next */ }
  }
  return null;
})();

async function save(canvas, name, scale = 1) {
  const svg = canvasToSvg(canvas);
  fs.writeFileSync(path.join(OUT, name + '.svg'), svg);
  if (!rasteriser) { console.log(`  ${name}.svg (no rasteriser — SVG only)`); return; }
  const r = new rasteriser.Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
  fs.writeFileSync(path.join(OUT, name + '.png'), r.render().asPng());
  console.log(`  ${name}.png`);
}

/* ======================================================================= */
const SF = await import('../src/render/SpriteFactory.js');

function sheet(w, h) { return new RecordingCanvas(w, h); }

/* ---- 1. machinery sheet ------------------------------------------------- */
{
  const c = sheet(1420, 900);
  const x = c.getContext();
  const g = x.createLinearGradient(0, 0, 0, 900);
  g.addColorStop(0, '#0c2a40'); g.addColorStop(1, '#061a2b');
  x.fillStyle = g; x.fillRect(0, 0, 1420, 900);
  x.globalAlpha = .12; x.strokeStyle = '#2b8fc4';
  for (let i = 0; i < 1420; i += 30) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 900); x.stroke(); }
  for (let i = 0; i < 900; i += 30) { x.beginPath(); x.moveTo(0, i); x.lineTo(1420, i); x.stroke(); }
  x.globalAlpha = 1;
  x.font = '700 22px sans-serif'; x.fillStyle = '#5fe0d2';
  x.fillText('PORT OPS — machinery (top-down, forward = right)', 30, 38);

  const panels = [
    { t: 'forklift', st: {}, scale: 4.2, x: 150, y: 150 },
    { t: 'reachstacker', st: { boomExtend: .12, spreaderLength: 40 }, scale: 1.7, x: 420, y: 150 },
    { t: 'rtg', st: { trolleyPos: .1, hoistHeight: .2, spreaderLength: 40 }, scale: 1.9, x: 950, y: 130 },
    { t: 'harborcrane', st: { boomExtend: .8, boomAngle: -.55, hoistHeight: .6, hookDrop: 1.4 }, scale: 1.9, x: 950, y: 430 },
    { t: 'tractor', st: {}, scale: 3.2, x: 200, y: 420 },
    { t: 'straddle', st: {}, scale: 2.4, x: 520, y: 640 }
  ];
  for (const p of panels) {
    x.font = '600 15px sans-serif'; x.fillStyle = '#9db6c9';
    x.fillText(`${p.t}`, p.x - 70, p.y + 108);
    SF.drawMachine(x, p.t, p.st, p.x, p.y, 0, p.scale);
  }
  await save(c, '01-machinery', 1);
}

/* ---- 2. animation states ------------------------------------------------ */
{
  const c = sheet(1400, 620);
  const x = c.getContext();
  x.fillStyle = '#071a2b'; x.fillRect(0, 0, 1400, 620);
  x.fillStyle = '#0e3049'; x.fillRect(0, 0, 1400, 58);
  x.font = '600 20px sans-serif'; x.fillStyle = '#ffc53d';
  x.fillText('machine states — boom extension, trolley travel, hoist depth', 24, 38);
  // reach stacker boom sweep
  [0, .45, 1].forEach((ext, i) => {
    SF.drawMachine(x, 'reachstacker', { boomExtend: ext, boomAngle: (i - 1) * .22, spreaderLength: 40 },
      110 + i * 240, 330, 0, 1.05);
    x.font = '600 13px sans-serif'; x.fillStyle = '#8fa3b4';
    x.fillText(`boom ${Math.round(ext * 100)}%`, 60 + i * 240, 470);
  });
  // RTG trolley/hoist
  [0, .5, 1].forEach((pos, i) => {
    SF.drawMachine(x, 'rtg', { trolleyPos: pos * 2 - 1, hoistHeight: i * .32, spreaderLength: 40 },
      880, 160 + i * 0, 0, 1.0, );
  });
  SF.drawMachine(x, 'rtg', { trolleyPos: .3, hoistHeight: .75, spreaderLength: 20 }, 1060, 330, 0, 1.0);
  x.font = '600 13px sans-serif'; x.fillStyle = '#8fa3b4';
  x.fillText('RTG: trolley along girder, hoist down, 20ft spreader', 880, 470);
  await save(c, '02-detail', 1);
}

/* ---- 3. cargo sheet ---------------------------------------------------- */
{
  const c = sheet(1400, 760);
  const x = c.getContext();
  x.fillStyle = '#0a1d2e'; x.fillRect(0, 0, 1400, 760);
  x.font = '600 20px sans-serif'; x.fillStyle = '#5fe0d2';
  x.fillText('container liveries · pallets · crates', 26, 38);
  let yy = 70;
  for (let i = 0; i < 5; i++) {
    const s = SF.containerSprite({ size: 40, liver: i, condition: i % 3, id: `POAU ${100 + i}234 7` });
    x.drawImage(s.canvas, 30, yy, s.canvas.width * 1.5, s.canvas.height * 1.5);
    yy += s.canvas.height * 1.5 + 14;
  }
  let y2 = 70;
  for (let i = 5; i < 10; i++) {
    const s = SF.containerSprite({ size: 20, liver: i, condition: i % 3, id: `POAU ${200 + i}477 3` });
    x.drawImage(s.canvas, 620, y2, s.canvas.width * 2.2, s.canvas.height * 2.2);
    y2 += s.canvas.height * 2.2 + 12;
  }
  for (let i = 0; i < 4; i++) {
    const p = SF.palletSprite(i);
    x.drawImage(p.canvas, 1070, 70 + i * 120, p.canvas.width * 3, p.canvas.height * 3);
    x.font = '500 12px sans-serif'; x.fillStyle = '#8fa3b4';
    x.fillText(p.kind, 1070, 70 + i * 120 + 80);
  }
  await save(c, '03-cargo', 1);
}

/* ---- 4. mentor portrait + brand ---------------------------------------- */
{
  const c = sheet(760, 330);
  const x = c.getContext();
  x.fillStyle = '#071726'; x.fillRect(0, 0, 760, 330);
  const p = SF.mentorPortrait(256);
  x.drawImage(p.canvas, 30, 40, 256, 256);
  const b = SF.brandMark(200);
  x.drawImage(b.canvas, 350, 60, 200, 200);
  const t = SF.machineThumb('reachstacker', 160, 120);
  x.drawImage(t.canvas, 580, 60);
  x.font = '600 14px sans-serif'; x.fillStyle = '#9db6c9';
  x.fillText('mentor portrait', 30, 315); x.fillText('brand mark', 350, 315); x.fillText('machine thumb', 580, 315);
  await save(c, '04-ui-art', 1);
}

console.log(`\npreview written to ${OUT}`);
