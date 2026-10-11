#!/usr/bin/env node
/**
 * scene-shot.mjs — dev-only: renders real in-game frames headlessly so the
 * world renderer, terminal model and machinery can be reviewed without a
 * browser. Uses the same modules the game ships.
 *
 *   node tools/scene-shot.mjs [outDir] [zoom]
 */
import { installDOM, canvasToSvg, RecordingCanvas } from './svgcanvas.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'preview');
const ZOOM = Number(process.argv[3] || 0.62);
fs.mkdirSync(OUT, { recursive: true });
installDOM({ width: 1600, height: 900 });

const req = createRequire('/tmp/pptr/package.json');
const { Resvg } = req('@resvg/resvg-js');

const layout = JSON.parse(fs.readFileSync(new URL('../src/data/terminal.json', import.meta.url), 'utf8'));

const { Terminal } = await import('../src/sim/Terminal.js');
const { Forklift } = await import('../src/sim/Forklift.js');
const { ReachStacker } = await import('../src/sim/ReachStacker.js');
const { RTG } = await import('../src/sim/RTG.js');
const { HarborCrane } = await import('../src/sim/HarborCrane.js');
const { AttachmentSystem } = await import('../src/sim/Attachments.js');
const { Camera } = await import('../src/engine/Camera.js');
const { Renderer } = await import('../src/render/Renderer.js');
const { TerrainRenderer } = await import('../src/render/TerrainRenderer.js');
const machines = JSON.parse(fs.readFileSync(new URL('../src/data/machines.json', import.meta.url), 'utf8'));

const events = [];
const bus = { emit: (t, p) => events.push([t, p]), on: () => () => {}, off() {}, once: () => () => {} };

const terminal = new Terminal(layout, bus);
const attach = new AttachmentSystem(terminal, bus);

const vehicles = [
  new Forklift(machines.forklift, { id: 'forklift-1', x: 40, y: 214, angle: 0, terminal, bus }),
  new ReachStacker(machines.reachstacker, { id: 'rs-1', x: 150, y: 206, angle: 0.4, terminal, bus }),
  new RTG(machines.rtg, { id: 'rtg-1', x: 66, y: 112, angle: 0, terminal, bus }),
  new HarborCrane(machines.harborcrane, { id: 'hc-1', x: 210, y: 214, angle: 0.2, terminal, bus })
];
// Real integration test: drive a reach stacker up to a loose container and lift it.
const rs = vehicles[1];
const freeBox = terminal.containers.find((c) => c.status === 'idle' && c.size === 20);
let liftReport = 'no loose container found';
if (freeBox) {
  rs.x = freeBox.x - 7.5; rs.y = freeBox.y; rs.angle = 0;
  rs.boomAngle = 0; rs.boomExtend = 0.12; rs.spreaderSize = 20;
  const ev = attach.evaluatePick(rs);
  liftReport = `${ev.code}: ${ev.message}`;
  if (ev.ok) { const r = attach.pick(rs); liftReport = r.message; }
  // forklift picks a pallet
  const fk = vehicles[0];
  const pal = terminal.pallets.find((p) => !p.hold);
  if (pal) { fk.x = pal.x - 3.4; fk.y = pal.y; fk.angle = 0; attach.pick(fk); }
}
console.log('reach stacker lift →', liftReport);

const camera = new Camera({ x: 60, y: 200, zoom: ZOOM, bounds: { x: 0, y: 0, w: layout.world.w, h: layout.world.h } });

const view = new RecordingCanvas(1600, 900);
const terrain = new TerrainRenderer(layout);
const renderer = new Renderer(view, { terminal, camera, terrain, bus });
renderer.resize(1600, 900, 1);
camera.resize(1600, 900);

const shots = [
  { name: 'scene-training', x: 74, y: 208, zoom: 5.0, note: 'training area + maintenance' },
  { name: 'scene-quay', x: 132, y: 48, zoom: 3.4, note: 'quay, ships and STS cranes' },
  { name: 'scene-yard', x: 118, y: 136, zoom: 3.8, note: 'container yard' },
  { name: 'scene-gate', x: 300, y: 192, zoom: 4.6, note: 'truck gate' },
  { name: 'scene-wide', x: 186, y: 124, zoom: 3.6, note: 'mid zoom' },
  { name: 'scene-overview', x: 186, y: 124, zoom: 2.0, note: 'overview' }
];

for (const s of shots) {
  camera.snapTo(s.x, s.y, s.zoom);
  renderer.time = 3.2;
  renderer.wavePhase = 4.4;
  renderer.showZones = true;
  renderer.zoneHighlight = { rect: { x: 120, y: 210, w: 30, h: 24 } };
  renderer.markers = [];
  const state = {
    vehicles,
    player: vehicles[0],
    markers: [
      { x: 144, y: 112, radius: 6, color: '#22c8b8' },
      { x: 300, y: 78, radius: 5, color: '#ffc53d' },
      { x: 210, y: 44, radius: 7, color: '#e5484d' }
    ],
    ghost: { x: 132, y: 214, w: 12, h: 2.6, valid: true },
    liftTarget: terminal.containers.find((c) => c.status === 'idle')
  };
  renderer.render(1 / 60, state);
  const svg = canvasToSvg(view);
  // the intermediate SVG is enormous (tens of MB); only keep it on request
  if (process.argv.includes('--svg')) fs.writeFileSync(path.join(OUT, s.name + '.svg'), svg);
  const r = new Resvg(svg, { fitTo: { mode: 'zoom', value: 1 }, font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } });
  fs.writeFileSync(path.join(OUT, s.name + '.png'), r.render().asPng());
  console.log(`  ${s.name}.png — ${s.note}`);
}

console.log(`\nterminal: ${terminal.slots.size} slots, ${terminal.containers.length} containers, ${terminal.trucks.length} trucks, ${terminal.ships.length} ships`);
