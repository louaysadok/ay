/**
 * SpriteFactory.js — all game art is generated procedurally at load time and
 * baked into offscreen canvases (a hand-made sprite pipeline in code).
 *
 * Every machine is drawn top-down with real proportions, cabins, wheels, booms,
 * spreaders, markings and warning lights. Sprites are cached per type+variant,
 * so the per-frame cost is a handful of drawImage calls.
 *
 * Scale convention: SPRITE_PPU pixels per world metre. Sprites are drawn larger
 * than the on-screen size at zoom 1 so they stay crisp when the player zooms in.
 */
import { roundRectPath, makeRng, rgba, shade, mixHex, TAU, clamp, clamp01 } from '../engine/Utils.js';

export const SPRITE_PPU = 16;      // machinery
export const CARGO_PPU = 18;       // containers / pallets

const PALETTE = {
  hull: '#1d5a86', hullDark: '#12405f', deck: '#2f7fae',
  cabin: '#e8f1f7', cabinGlass: '#1a3d55', cabinDark: '#c3d5e0',
  tyre: '#232a2f', tyreLight: '#39424a', rim: '#c8d4dd',
  steel: '#8798a6', steelDark: '#5d6c79', steelLight: '#b9c6d1',
  yellow: '#ffc53d', yellowDeep: '#e0a11a',
  red: '#d9484f', white: '#f2f7fb',
  mast: '#4d5a66', fork: '#aab6c0',
  hyd: '#2b3844', hydLight: '#c9d3da',
  beaconAmber: '#ffb020', beaconRed: '#ff4d4d'
};

/* ---------------------------------------------------------------- helpers -- */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

const rr = (ctx, x, y, w, h, r) => roundRectPath(ctx, x, y, w, h, r);

function fillRR(ctx, x, y, w, h, r, fill) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
function strokeRR(ctx, x, y, w, h, r, stroke, lw = 1) {
  rr(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}
/** Linear gradient helper in normalized sprite space. */
function grad(ctx, x, y, w, h, stops, vertical = true) {
  const g = vertical ? ctx.createLinearGradient(x, y, x, y + h) : ctx.createLinearGradient(x, y, x + w, y);
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

/* ====================================================================== */
/*  CARGO — shipping containers, pallets, crates, drums                   */
/* ====================================================================== */

/** Fictional shipping lines (no real-world trademarks). */
export const CONTAINER_LIVERS = [
  { id: 'northport', name: 'NORTHPORT', body: '#1b6aa5', roof: '#2a83c4', text: '#eaf4fb', accent: '#0f4e7e' },
  { id: 'azura', name: 'AZURA', body: '#0f9d8e', roof: '#18bda9', text: '#eafaf7', accent: '#0a7268' },
  { id: 'kestrel', name: 'KESTREL', body: '#d0562b', roof: '#e8743f', text: '#fff3ec', accent: '#a03d1c' },
  { id: 'bluemax', name: 'BLUEMAX', body: '#2b4fa0', roof: '#3d68c2', text: '#eef3ff', accent: '#1d3775' },
  { id: 'orion', name: 'ORION', body: '#c9424b', roof: '#e05a63', text: '#fff0f1', accent: '#9a2b32' },
  { id: 'meridian', name: 'MERIDIAN', body: '#f0b429', roof: '#ffc94f', text: '#3a2b05', accent: '#c08c12' },
  { id: 'cobalt', name: 'COBALT', body: '#4b5563', roof: '#5f6b7a', text: '#eef2f6', accent: '#343b45' },
  { id: 'sanmar', name: 'SANMAR', body: '#e8eef3', roof: '#f8fbfd', text: '#173146', accent: '#c4d2dc' },
  { id: 'harbour', name: 'HARBOUR', body: '#7a3fa8', roof: '#9358c2', text: '#f6efff', accent: '#592a80' },
  { id: 'venta', name: 'VENTA', body: '#1f7a4d', roof: '#2c9a63', text: '#eafbf1', accent: '#145536' }
];

const containerCache = new Map();

/**
 * Container sprite (top-down). Coordinates: sprite is `len` x `wid` metres.
 * Includes corrugated roof ribs, corner castings, door end, ID markings.
 */
export function containerSprite({ size = 40, liver = 0, condition = 0, id = 'POAU 000000 0', rotated = false } = {}) {
  const key = `c${size}_${liver}_${condition}_${id}_${rotated}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const L = size === 40 ? 12.19 : (size === 45 ? 13.72 : 6.06);
  const W = 2.44;
  const ppu = CARGO_PPU;
  const pad = 2;
  const pxW = Math.round(L * ppu) + pad * 2;
  const pxH = Math.round(W * ppu) + pad * 2;
  const { canvas, ctx } = makeCanvas(pxW, pxH);
  const lv = CONTAINER_LIVERS[liver % CONTAINER_LIVERS.length];
  const rng = makeRng(1000 + liver * 31 + condition * 7 + size);
  const x = pad, y = pad, w = L * ppu, h = W * ppu;
  const r = 3.2;

  // body with roof gradient (light from the north-west)
  fillRR(ctx, x, y, w, h, r, grad(ctx, x, y, w, h, [[0, shade(lv.roof, .06)], [.45, lv.roof], [1, shade(lv.body, -.1)]]));
  strokeRR(ctx, x + .5, y + .5, w - 1, h - 1, r, rgba('#040d15', .38), 1);

  // corrugated roof ribs
  ctx.save();
  rr(ctx, x, y, w, h, r); ctx.clip();
  ctx.globalAlpha = .16;
  ctx.strokeStyle = '#03121c';
  ctx.lineWidth = 1;
  const step = 0.28 * ppu;
  for (let i = x + 4; i < x + w - 3; i += step) {
    ctx.beginPath(); ctx.moveTo(i, y + 2.5); ctx.lineTo(i, y + h - 2.5); ctx.stroke();
  }
  ctx.globalAlpha = .1; ctx.strokeStyle = '#ffffff';
  for (let i = x + 4 + step * .5; i < x + w - 3; i += step) {
    ctx.beginPath(); ctx.moveTo(i, y + 2.5); ctx.lineTo(i, y + h - 2.5); ctx.stroke();
  }

  // weathering / rust patches
  if (condition > 0) {
    ctx.globalAlpha = condition === 2 ? .34 : .18;
    for (let i = 0; i < 10 + condition * 8; i++) {
      const px = x + rng.range(3, w - 3), py = y + rng.range(2, h - 2);
      const rr2 = rng.range(2, 9 + condition * 4);
      ctx.fillStyle = rng.pick(['#7a4a24', '#8d5a2b', '#5a3a1c', '#c9c0b4']);
      ctx.beginPath(); ctx.ellipse(px, py, rr2, rr2 * rng.range(.35, .75), rng.range(0, 6), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // corner castings
  ctx.fillStyle = 'rgba(20,30,38,.72)';
  const cs = 3.4;
  for (const [cx2, cy2] of [[x + 2.5, y + 2.5], [x + w - 2.5, y + 2.5], [x + 2.5, y + h - 2.5], [x + w - 2.5, y + h - 2.5]]) {
    fillRR(ctx, cx2 - cs / 2, cy2 - cs / 2, cs, cs, 1, 'rgba(22,32,40,.75)');
  }

  // operator branding band + unit code (name left, code hard right)
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = .95;
  ctx.fillStyle = lv.text;
  const fs = Math.max(6, Math.min(0.40 * ppu, (w - 3.4 * ppu) / (lv.name.length * 0.62)));
  ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(lv.name, x + 1.1 * ppu, y + h * .5);
  ctx.font = `600 ${Math.max(5, Math.min(0.30 * ppu, fs * .8))}px ui-monospace, monospace`;
  ctx.globalAlpha = .85;
  ctx.textAlign = 'right';
  ctx.fillText(id.replace(/\s+/g, ' '), x + w - 1.1 * ppu, y + h * .5);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;

  // roof hash marks along the middle (spreader alignment aid)
  ctx.globalAlpha = .2; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w * .5, y + 3); ctx.lineTo(x + w * .5, y + h - 3);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // end doors emphasis
  ctx.globalAlpha = .35;
  ctx.fillStyle = '#02121c';
  ctx.fillRect(x + w - 2.2, y + 1, 1.4, h - 2);
  ctx.globalAlpha = 1;

  // highlight rim (light from NW)
  ctx.globalAlpha = .22;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  rr(ctx, x + .6, y + .6, w - 1.2, h - 1.2, r); ctx.stroke();
  ctx.globalAlpha = 1;

  const out = { canvas, w: L, h: W, ppu, drawW: canvas.width / ppu, drawH: canvas.height / ppu };
  containerCache.set(key, out);
  return out;
}

/** Palletised cargo: pallet + strapped stack of cartons or bagged goods. */
export function palletSprite(variant = 0) {
  const key = `pal${variant}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const ppu = CARGO_PPU;
  const W = 1.2, L = 1.2;
  const pad = 2;
  const { canvas, ctx } = makeCanvas(W * ppu + pad * 2, L * ppu + pad * 2);
  const x = pad, y = pad, w = W * ppu, h = L * ppu;
  const kinds = [
    { c: '#c8a06a', label: '#8d6a37', name: 'cartons' },
    { c: '#8fb0c9', label: '#5b7d97', name: 'bags' },
    { c: '#b9c4cd', label: '#7d8894', name: 'drums' },
    { c: '#c98f8f', label: '#946262', name: 'tiles' }
  ];
  const k = kinds[variant % kinds.length];
  // pallet base
  fillRR(ctx, x, y, w, h, 2, '#a97f4d');
  ctx.globalAlpha = .5; ctx.fillStyle = '#7c5b34';
  for (let i = 1; i < 4; i++) ctx.fillRect(x, y + (h / 4) * i - .8, w, 1.6);
  ctx.globalAlpha = 1;
  // load
  fillRR(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 1.6, k.c);
  ctx.globalAlpha = .3;
  ctx.strokeStyle = k.label; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(x + 2, y + (h / 5) * i); ctx.lineTo(x + w - 2, y + (h / 5) * i); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(x + w / 2, y + 2); ctx.lineTo(x + w / 2, y + h - 2); ctx.stroke();
  // straps
  ctx.globalAlpha = .75; ctx.strokeStyle = '#2f3a44'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x + 2.4, y + 2); ctx.lineTo(x + 2.4, y + h - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w - 2.4, y + 2); ctx.lineTo(x + w - 2.4, y + h - 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalAlpha = .28; strokeRR(ctx, x + .6, y + .6, w - 1.2, h - 1.2, 1.6, '#ffffff', 1); ctx.globalAlpha = 1;
  const out = { canvas, w: W, h: L, ppu, kind: k.name, drawW: canvas.width / ppu, drawH: canvas.height / ppu };
  containerCache.set(key, out);
  return out;
}

/** Small cargo props used in warehouse work: crates and drums. */
export function crateSprite(variant = 0) {
  const key = `cra${variant}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const ppu = CARGO_PPU;
  const s = variant === 1 ? 1.5 : 1.1;
  const { canvas, ctx } = makeCanvas(s * ppu + 4, s * ppu + 4);
  if (variant === 1) {                       // steel drum cluster
    const r = s * ppu / 3.1;
    for (let i = 0; i < 3; i++) {
      const cx = 2 + r + (i % 2) * r * 0.9, cy = 2 + r * 1.1 + Math.floor(i / 2) * r * 1.7;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = i === 1 ? '#3f7fb7' : '#2f6a9c'; ctx.fill();
      ctx.strokeStyle = 'rgba(4,18,28,.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * .58, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - r * .3, cy - r * .35, r * .18, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();
    }
  } else {                                    // wooden crate
    const w = s * ppu, h = s * ppu;
    fillRR(ctx, 2, 2, w, h, 2, grad(ctx, 2, 2, w, h, [[0, '#c79a63'], [1, '#a87c47']]));
    ctx.strokeStyle = 'rgba(60,40,18,.55)'; ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 2.5, w - 1, h - 1);
    ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(2 + w, 2 + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2 + w, 2); ctx.lineTo(2, 2 + h); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const out = { canvas, w: s, h: s, ppu, drawW: canvas.width / ppu, drawH: canvas.height / ppu };
  containerCache.set(key, out);
  return out;
}

/* ====================================================================== */
/*  MACHINERY                                                             */
/* ====================================================================== */

/**
 * Convert a drawn sprite into a soft drop shadow silhouette:
 * copy, flood black, offset+blur, then use as a separate rotated layer so the
 * shadow direction stays fixed in world space.
 */
function shadowFrom(canvas, blur = 3.2) {
  const { canvas: sc, ctx } = makeCanvas(canvas.width, canvas.height);
  ctx.globalAlpha = .38;
  if ('filter' in ctx) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#02080e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  sc.__tint = '#02080e';     // read by the headless SVG recorder (dev tooling)
  return sc;
}

const machineCache = new Map();
function machine(type, def) {
  const drawFn = def.fn, footprint = def.fp;
  if (machineCache.has(type)) return machineCache.get(type);
  const ppu = SPRITE_PPU;
  const pad = 10;
  // canvas X axis = machine length (forward), Y axis = width across
  const L = Math.round(footprint.l * ppu);
  const W = Math.round(footprint.w * ppu);
  const { canvas, ctx } = makeCanvas(L + pad * 2, W + pad * 2);
  ctx.save();
  ctx.translate(pad, pad);
  drawFn(ctx, L, W, ppu);
  ctx.restore();
  const shadow = shadowFrom(canvas, 3.6);
  const out = {
    canvas, shadow, w: footprint.w, l: footprint.l, ppu, pad,
    drawW: canvas.width / ppu, drawH: canvas.height / ppu   // sprite size in metres
  };
  machineCache.set(type, out);
  return out;
}

/* ------------------------------------------------------- shared paintbits -- */
/** Wheel seen from above: tyre + rim + tread, squashY compress along X. */
function wheel(ctx, cx, cy, r, { twin = false, rim = '#9aa7b2', dark = '#1e252b', tread = true } = {}) {
  const rx = r * .62, ry = r;
  const draw = (ox) => {
    ctx.beginPath(); ctx.ellipse(cx + ox, cy, rx, ry, 0, 0, TAU);
    ctx.fillStyle = dark; ctx.fill();
    if (tread) {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx + ox, cy, rx, ry, 0, 0, TAU); ctx.clip();
      ctx.globalAlpha = .45; ctx.strokeStyle = '#0a0f13'; ctx.lineWidth = 1;
      for (let i = -ry; i <= ry; i += 2.6) {
        ctx.beginPath(); ctx.moveTo(cx + ox - rx, cy + i); ctx.lineTo(cx + ox + rx, cy + i); ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.ellipse(cx + ox, cy, rx * .5, ry * .48, 0, 0, TAU);
    ctx.fillStyle = rim; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + ox, cy, rx * .18, ry * .17, 0, 0, TAU);
    ctx.fillStyle = dark; ctx.fill();
    ctx.globalAlpha = .35; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx + ox - rx * .2, cy - ry * .3, rx * .22, ry * .18, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  };
  if (twin) { draw(-rx * .85); draw(rx * .85); } else draw(0);
}

/** Yellow/black hazard stripes filling a rect. */
function hazard(ctx, x, y, w, h, color = '#1b1b1b') {
  ctx.save();
  rr(ctx, x, y, w, h, 1); ctx.clip();
  ctx.fillStyle = color; ctx.globalAlpha = .55;
  const step = 5.4;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y);
    ctx.lineTo(x + i + h + step * .5, y); ctx.lineTo(x + i + step * .5, y + h);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Cabin / operator cab drawn from above (roof, glass, sun visor). */
function cabin(ctx, x, y, w, h, { glass = PALETTE.cabinGlass, roof = '#eef5fa', roof2 = '#c3d6e2' } = {}) {
  fillRR(ctx, x - 1, y - 1, w + 2, h + 2, 3, '#39464f');
  fillRR(ctx, x, y, w, h, 2.6, grad(ctx, 0, y, 0, y + h, [[0, roof], [1, roof2]]));
  // front windscreen + side glass
  ctx.fillStyle = glass;
  fillRR(ctx, x + w * .62, y + h * .08, w * .33, h * .84, 1.8, glass);
  fillRR(ctx, x + w * .06, y + h * .06, w * .28, h * .88, 1.8, '#20475f');
  ctx.globalAlpha = .4; ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + w * .08, y + h * .1, Math.max(1, w * .05), h * .8);
  ctx.globalAlpha = 1;
  // roof hatch + beacon mount
  ctx.globalAlpha = .5; ctx.strokeStyle = '#9fb2c0'; ctx.lineWidth = 1;
  rr(ctx, x + w * .40, y + h * .22, w * .18, h * .56, 1.5); ctx.stroke();
  ctx.globalAlpha = 1;
  strokeRR(ctx, x + .5, y + .5, w - 1, h - 1, 2.6, 'rgba(16,28,38,.6)', 1.1);
}

function beacon(ctx, x, y, r, color = PALETTE.beaconAmber) {
  ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU);
  ctx.fillStyle = rgba(color, .22); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(x - r * .3, y - r * .3, r * .4, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
}

/* ------------------------------------------------------------- FORKLIFT --- */
/**
 * Counterbalance forklift. Forks point +X. The mast, carriage and tines are
 * drawn by drawAttachment() so they can side-shift and cycle with the load.
 */
function drawForklift(ctx, L, W, ppu) {
  // +X is FORWARD. Layout rear → front: counterweight · engine hood · operator
  // station (overhead guard) · mast · forks (drawn by drawAttachment).
  const cy = W * .5;
  const cwEnd = L * .17;            // counterweight   0.02 .. 0.17 L
  const body0 = L * .15, body1 = L * .56;
  const cabX = L * .36, cabL = L * .26;
  const mastX = L * .62;

  // ---- counterweight -----------------------------------------------------
  fillRR(ctx, cwEnd * .12, cy - W * .50, cwEnd * .88, W, 3,
    grad(ctx, 0, cy - W * .50, 0, cy + W * .50, [[0, '#f6d361'], [.45, '#e6bc2c'], [1, '#c09a15']]));
  hazard(ctx, cwEnd * .18, cy - W * .48, cwEnd * .22, W * .96);
  hazard(ctx, cwEnd * .52, cy - W * .48, cwEnd * .22, W * .96);
  // towing pin + rear lights
  ctx.fillStyle = '#8a98a3';
  ctx.beginPath(); ctx.arc(cwEnd * .06, cy, ppu * .085, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e04a4a';
  ctx.beginPath(); ctx.arc(cwEnd * .14, cy - W * .40, ppu * .055, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(cwEnd * .14, cy + W * .40, ppu * .055, 0, TAU); ctx.fill();

  // ---- chassis / engine hood --------------------------------------------
  fillRR(ctx, body0, cy - W * .44, body1 - body0, W * .88, 2.4,
    grad(ctx, 0, cy - W * .44, 0, cy + W * .44, [[0, '#ffe07a'], [.45, '#f6c62e'], [1, '#d3a316']]));
  // hood louvres (engine bay, rear half)
  ctx.globalAlpha = .22; ctx.strokeStyle = '#8a6408'; ctx.lineWidth = .9;
  for (let i = 0; i < 6; i++) {
    const xx = body0 + (body1 - body0) * (.06 + i * .045);
    ctx.beginPath(); ctx.moveTo(xx, cy - W * .38); ctx.lineTo(xx, cy + W * .38); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // side step / fuel tank
  fillRR(ctx, body0 + (body1 - body0) * .5, cy - W * .40, (body1 - body0) * .22, W * .12, 1.4, '#8b6512');
  fillRR(ctx, body0 + (body1 - body0) * .5, cy + W * .28, (body1 - body0) * .22, W * .12, 1.4, '#8b6512');

  // ---- operator station (overhead guard) --------------------------------
  cabin(ctx, cabX, cy - W * .43, cabL, W * .86);
  // operator seat + steering column seen through the guard
  ctx.globalAlpha = .34; ctx.fillStyle = '#1d2a34';
  fillRR(ctx, cabX + cabL * .16, cy - W * .17, cabL * .30, W * .34, 1.4, '#1d2a34');
  ctx.beginPath(); ctx.arc(cabX + cabL * .74, cy, ppu * .13, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  // ---- mast (tines are dynamic) -----------------------------------------
  ctx.fillStyle = '#4a5760';
  fillRR(ctx, mastX, cy - W * .46, ppu * .32, W * .92, 1.2,
    grad(ctx, 0, cy - W * .46, 0, cy + W * .46, [[0, '#7c8a96'], [.5, '#4d5a65'], [1, '#333e48']]));
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillRect(mastX + ppu * .05, cy - W * .43, Math.max(1, ppu * .07), W * .86);
  // lift cylinders alongside the mast
  ctx.fillStyle = '#5c6a75';
  fillRR(ctx, mastX - ppu * .02, cy - W * .34, ppu * .14, ppu * .26, .8, '#5c6a75');
  fillRR(ctx, mastX - ppu * .02, cy + W * .08, ppu * .14, ppu * .26, .8, '#5c6a75');
  // front fenders
  ctx.globalAlpha = .5; ctx.fillStyle = '#b8901a';
  fillRR(ctx, mastX - ppu * .55, cy - W * .52, ppu * .5, W * .18, 1.2, '#b8901a');
  fillRR(ctx, mastX - ppu * .55, cy + W * .34, ppu * .5, W * .18, 1.2, '#b8901a');
  ctx.globalAlpha = 1;

  // ---- wheels: steer axle rear, drive axle under the mast ---------------
  wheel(ctx, body0 + (body1 - body0) * .06, cy - W * .49, ppu * .19);
  wheel(ctx, body0 + (body1 - body0) * .06, cy + W * .49, ppu * .19);
  wheel(ctx, mastX - ppu * .55, cy - W * .50, ppu * .25);
  wheel(ctx, mastX - ppu * .55, cy + W * .50, ppu * .25);

  beacon(ctx, body0 + (body1 - body0) * .02, cy - W * .48, ppu * .10);
}

/* -------------------------------------------------------- REACH STACKER --- */
/**
 * Reach stacker chassis: rear engine deck + counterweight, 4 big wheels, the
 * operators cab sits at the front-left. The telescopic boom is dynamic
 * (drawAttachment) and pivots at the turntable centre.
 */
function drawReachStacker(ctx, L, W, ppu) {
  const cy = W * .5;
  const x0 = L * .06, x1 = L * .97;
  const bl = x1 - x0;

  // chassis deck
  fillRR(ctx, x0, cy - W * .40, bl, W * .80, 3.4,
    grad(ctx, 0, cy - W * .40, 0, cy + W * .40, [[0, '#f4f9fd'], [.45, '#dde8f0'], [1, '#bcccd9']]));
  // rear engine deck + exhaust
  ctx.globalAlpha = .5; ctx.fillStyle = '#8ea0ae';
  fillRR(ctx, x0, cy - W * .34, bl * .30, W * .68, 2, '#93a5b3');
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2f3a43';
  ctx.beginPath(); ctx.arc(x0 + bl * .12, cy - W * .26, ppu * .11, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x0 + bl * .12, cy + W * .26, ppu * .11, 0, TAU); ctx.fill();
  // counterweight
  fillRR(ctx, x0 - ppu * .28, cy - W * .40, ppu * .42, W * .80, 2, '#414d57');
  hazard(ctx, x0 - ppu * .24, cy - W * .36, ppu * .16, W * .72);

  // deck plating lines
  ctx.globalAlpha = .22; ctx.strokeStyle = '#6f8595'; ctx.lineWidth = .9;
  for (let i = 1; i < 8; i++) {
    const xx = x0 + (bl / 8) * i;
    ctx.beginPath(); ctx.moveTo(xx, cy - W * .38); ctx.lineTo(xx, cy - W * .12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xx, cy + W * .12); ctx.lineTo(xx, cy + W * .38); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // hydraulic tank + toolboxes
  fillRR(ctx, x0 + bl * .34, cy + W * .16, bl * .18, W * .2, 1.6, '#4b5864');
  fillRR(ctx, x0 + bl * .56, cy + W * .18, bl * .14, W * .16, 1.6, '#5a6874');

  // operator cab at the front-left corner
  const cw = W * .40, cl = L * .20;
  cabin(ctx, x1 - cl - ppu * .1, cy - W * .48, cl, cw);
  beacon(ctx, x1 - cl * .5, cy - W * .46, ppu * .12);

  // wheels: 2 axles × twin wheels
  wheel(ctx, x0 + bl * .20, cy - W * .47, ppu * .40, { twin: false });
  wheel(ctx, x0 + bl * .20, cy + W * .47, ppu * .40);
  wheel(ctx, x0 + bl * .80, cy - W * .47, ppu * .40);
  wheel(ctx, x0 + bl * .80, cy + W * .47, ppu * .40);
  // front axle beam
  ctx.fillStyle = '#39454f';
  fillRR(ctx, x0 + bl * .74, cy - W * .44, ppu * .16, W * .88, 1.4, '#39454f');
}

/* ----------------------------------------------------------- RTG CRANE --- */
/**
 * Rubber-Tyred Gantry crane.
 *   * travels along +X (the block direction)
 *   * the two main girders run along Y (the span) and carry the trolley
 *   * containers sit under the portal with their long axis along X
 * The trolley, cables and spreader are dynamic (drawAttachment).
 */
function drawRTG(ctx, L, W, ppu) {
  const cx = L * .5, cy = W * .5;
  const base = L * .62;                       // girder separation along X
  const girderT = ppu * .40;                  // girder thickness (X)
  const legW = ppu * .44;
  const y0 = ppu * .30, y1 = W - ppu * .30;   // girder ends (span)
  const gx = [cx - base * .5, cx + base * .5];

  // shadow of the portal footprint
  ctx.globalAlpha = .16; ctx.fillStyle = '#04141f';
  fillRR(ctx, cx - base * .5, cy - W * .5, base, W, 4, '#04141f');
  ctx.globalAlpha = 1;

  // ---- the two girders (run along Y) -------------------------------------
  const drawGirder = (gX) => {
    fillRR(ctx, gX - girderT * .5, y0, girderT, y1 - y0, 2,
      grad(ctx, gX - girderT * .5, 0, gX + girderT * .5, 0, [[0, '#3f93c4'], [.45, '#20648c'], [1, '#123f5c']], false));
    // top rail + highlight
    ctx.globalAlpha = .5; ctx.fillStyle = '#e8f2f8';
    ctx.fillRect(gX - girderT * .34, y0, Math.max(1.4, girderT * .16), y1 - y0);
    ctx.globalAlpha = .3; ctx.fillStyle = '#cfe4f0';
    ctx.fillRect(gX + girderT * .18, y0 + 2, Math.max(1, girderT * .1), y1 - y0 - 4);
    ctx.globalAlpha = 1;
    // trolley end stops
    fillRR(ctx, gX - girderT * .62, y0 - ppu * .1, girderT * 1.24, ppu * .2, 1, '#e0a11a');
    fillRR(ctx, gX - girderT * .62, y1 - ppu * .1, girderT * 1.24, ppu * .2, 1, '#e0a11a');
  };
  gx.forEach(drawGirder);

  // ---- legs + bogies at the four corners ---------------------------------
  for (const gX of gx) {
    for (const ey of [y0 + legW * .5, y1 - legW * .5]) {
      // leg column
      fillRR(ctx, gX - legW * .5, ey - legW * .5, legW, legW, 1.6,
        grad(ctx, gX - legW * .5, 0, gX + legW * .5, 0, [[0, '#1d5478'], [.45, '#3684b0'], [1, '#123d59']], false));
      // X-brace between the legs of one side
      ctx.globalAlpha = .45; ctx.strokeStyle = '#14435f'; ctx.lineWidth = Math.max(1, ppu * .07);
      ctx.beginPath();
      ctx.moveTo(gX - legW * .46, ey - legW * .46); ctx.lineTo(gX + legW * .46, ey + legW * .46); ctx.stroke();
      ctx.globalAlpha = 1;
      // bogie plate + 2 wheels (axle along Y: wheel squashed along X)
      fillRR(ctx, gX - ppu * .52, ey - ppu * .34, ppu * 1.04, ppu * .68, 2, '#39454f');
      wheel(ctx, gX - ppu * .30, ey, ppu * .28);
      wheel(ctx, gX + ppu * .30, ey, ppu * .28);
    }
  }

  // ---- machine house outside the portal, on the -X side ------------------
  const hl = base * .54, hw = W * .34;
  const hx = gx[0] + girderT * .9, hy = y1 - hw - ppu * .1;
  fillRR(ctx, hx, hy, hl, hw, 2.6,
    grad(ctx, 0, hy, 0, hy + hw, [[0, '#f7fbfe'], [.5, '#e0eaf1'], [1, '#c2d3de']]));
  ctx.globalAlpha = .5; ctx.strokeStyle = '#8fa6b6'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const xx = hx + (hl / 6) * i;
    ctx.beginPath(); ctx.moveTo(xx, hy + hw * .1); ctx.lineTo(xx, hy + hw * .9); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // exhaust stacks
  ctx.fillStyle = '#2f3a43';
  ctx.beginPath(); ctx.arc(hx + hl * .82, hy + hw * .2, ppu * .12, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + hl * .82, hy + hw * .8, ppu * .12, 0, TAU); ctx.fill();
  // maintenance walkway along the far girder
  ctx.globalAlpha = .45; ctx.fillStyle = '#8b98a3';
  fillRR(ctx, gx[0] + girderT * .9, y0 + ppu * .1, base - girderT * 1.8, ppu * .5, 1, '#8b98a3');
  ctx.globalAlpha = 1;

  // ---- beacons ----------------------------------------------------------
  beacon(ctx, gx[1] + girderT * .1, cy - W * .46, ppu * .13);
  beacon(ctx, gx[1] + girderT * .1, cy + W * .46, ppu * .13);
  ctx.fillStyle = PALETTE.beaconRed;
  ctx.beginPath(); ctx.arc(gx[0] - girderT * .1, cy - W * .46, ppu * .1, 0, TAU); ctx.fill();
}

/* ------------------------------------------------- MOBILE HARBOUR CRANE --- */
/** Crawler-mounted harbour crane: twin tracks, turntable superstructure + cab. */
function drawHarborCrane(ctx, L, W, ppu) {
  const cy = W * .5;
  const x0 = L * .06, x1 = L * .95;
  const trackW = ppu * .66;
  const trackY = W * .5 - trackW * .5 - ppu * .12;      // ± from centre
  const cx = L * .46, cY = cy;

  // ---- crawler tracks (twin, steerable) ---------------------------------
  for (const s of [-1, 1]) {
    const ty = cy + s * trackY - trackW * .5;
    fillRR(ctx, x0, ty, x1 - x0, trackW, 2.6,
      grad(ctx, 0, ty, 0, ty + trackW, [[0, '#454f57'], [.45, '#2b3238'], [1, '#171d22']]));
    ctx.globalAlpha = .55; ctx.fillStyle = '#0d1114';
    const step = trackW / 4.4;
    for (let i = x0 + 3; i < x1 - 4; i += step) ctx.fillRect(i, ty + 1.6, 1.8, trackW - 3.2);
    ctx.globalAlpha = .28; ctx.strokeStyle = '#93a0aa'; ctx.lineWidth = 1;
    rr(ctx, x0 + .5, ty + .5, x1 - x0 - 1, trackW - 1, 2.6); ctx.stroke();
    ctx.globalAlpha = 1;
    // drive sprocket ends
    ctx.fillStyle = '#20272d';
    fillRR(ctx, x0 - ppu * .1, ty + trackW * .1, ppu * .22, trackW * .8, 1.6, '#20272d');
    fillRR(ctx, x1 - ppu * .12, ty + trackW * .1, ppu * .22, trackW * .8, 1.6, '#20272d');
  }

  // ---- carrier frame between the tracks ---------------------------------
  fillRR(ctx, x0 + ppu * .2, cy - W * .30, (x1 - x0) - ppu * .4, W * .60, 2,
    grad(ctx, 0, cy - W * .22, 0, cy + W * .22, [[0, '#5b6873'], [1, '#3b464f']]));
  ctx.globalAlpha = .35; ctx.strokeStyle = '#1c242b'; ctx.lineWidth = 1.4;
  for (let i = 1; i < 5; i++) {
    const xx = x0 + ppu * .4 + ((x1 - x0 - ppu * .8) / 5) * i;
    ctx.beginPath(); ctx.moveTo(xx, cy - W * .28); ctx.lineTo(xx, cy + W * .28); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- turntable rim + slew bearing (a thin ring, not a disc) -----------
  const tr = W * .36;
  ctx.beginPath(); ctx.arc(cx, cY, tr, 0, TAU);
  ctx.strokeStyle = '#2b333a'; ctx.lineWidth = ppu * .30; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cY, tr - ppu * .22, 0, TAU);
  ctx.strokeStyle = '#5a6873'; ctx.lineWidth = ppu * .10; ctx.stroke();
  ctx.globalAlpha = .55; ctx.strokeStyle = '#98a5b0'; ctx.lineWidth = 1.1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (tr - ppu * .3), cY + Math.sin(a) * (tr - ppu * .3));
    ctx.lineTo(cx + Math.cos(a) * (tr + ppu * .22), cY + Math.sin(a) * (tr + ppu * .22));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- rotating superstructure (yellow) ---------------------------------
  const sl = L * .46, sw = W * .88;
  const sx0 = cx - sl * .44, sy0 = cY - sw * .5;
  fillRR(ctx, sx0, sy0, sl, sw, 4,
    grad(ctx, 0, sy0, 0, sy0 + sw, [[0, '#ffe07c'], [.45, '#f3c62c'], [1, '#c89a10']]));
  ctx.globalAlpha = .28; ctx.strokeStyle = '#7a5905'; ctx.lineWidth = 1.1;
  rr(ctx, sx0 + 3, sy0 + 3, sl - 6, sw - 6, 3); ctx.stroke();
  ctx.globalAlpha = 1;
  hazard(ctx, sx0 + 2, sy0 + sw * .06, sl * .12, sw * .88);

  // machinery housing + winch drum
  fillRR(ctx, sx0 + sl * .14, sy0 + sw * .12, sl * .48, sw * .76, 2.6, '#4b5760');
  fillRR(ctx, sx0 + sl * .18, sy0 + sw * .20, sl * .30, sw * .60, 2, '#333d45');
  ctx.globalAlpha = .5; ctx.strokeStyle = '#20272d'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const xx = sx0 + sl * .20 + i * sl * .05;
    ctx.beginPath(); ctx.moveTo(xx, sy0 + sw * .22); ctx.lineTo(xx, sy0 + sw * .78); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2b333a';
  ctx.beginPath(); ctx.arc(sx0 + sl * .56, sy0 + sw * .30, ppu * .15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(sx0 + sl * .56, sy0 + sw * .70, ppu * .15, 0, TAU); ctx.fill();

  // counterweight block bolted to the rear of the superstructure
  fillRR(ctx, sx0 - ppu * .78, sy0 + sw * .10, ppu * .82, sw * .80, 2,
    grad(ctx, 0, sy0, 0, sy0 + sw, [[0, '#525f6a'], [1, '#333d45']]));
  hazard(ctx, sx0 - ppu * .70, sy0 + sw * .14, ppu * .22, sw * .72);

  // operator cab: front-right corner, looking down the boom
  const cw2 = sw * .40, cl2 = ppu * 1.35;
  cabin(ctx, sx0 + sl * .70, sy0 + sw * .12, cl2, cw2);
  // handrails along the deck edge
  ctx.globalAlpha = .4; ctx.strokeStyle = '#8e9aa5'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx0 + 2, sy0 + sw + 1.5); ctx.lineTo(sx0 + sl - 2, sy0 + sw + 1.5); ctx.stroke();
  ctx.globalAlpha = 1;
  // access stairs from the carrier deck up to the superstructure
  ctx.fillStyle = '#59666f';
  fillRR(ctx, sx0 + sl * .02, cy - W * .07, ppu * .8, W * .14, 1.4, '#59666f');
  ctx.fillStyle = 'rgba(10,16,20,.5)';
  for (let i = 0; i < 4; i++) ctx.fillRect(sx0 + sl * .04 + i * ppu * .16, cy - W * .055, 1.5, W * .11);

  beacon(ctx, sx0 + sl * .95, sy0 + sw * .12, ppu * .13, PALETTE.beaconRed);
  beacon(ctx, sx0 + sl * .95, sy0 + sw * .88, ppu * .13, PALETTE.beaconRed);
  // lifting lugs / floodlights
  ctx.fillStyle = '#f0f6fa';
  for (const p of [[sx0 + sl * .7, sy0 + sw * .06], [sx0 + sl * .7, sy0 + sw * .94]]) {
    ctx.beginPath(); ctx.arc(p[0], p[1], ppu * .12, 0, TAU); ctx.fill();
  }
}

/* ------------------------------------------------------ TERMINAL TRACTOR -- */
function drawTractor(ctx, L, W, ppu) {
  const cy = W * .5;
  const x0 = L * .06, x1 = L * .98, bl = x1 - x0;
  // chassis rail
  fillRR(ctx, x0, cy - W * .26, bl, W * .52, 2, '#39454f');
  // cab-over unit (front)
  const cl = bl * .40;
  fillRR(ctx, x1 - cl, cy - W * .46, cl, W * .92, 3,
    grad(ctx, 0, cy - W * .46, 0, cy + W * .46, [[0, '#3fa0cd'], [.5, '#2c86b3'], [1, '#1d6288']]));
  cabin(ctx, x1 - cl + cl * .16, cy - W * .40, cl * .80, W * .80);
  ctx.globalAlpha = .22; ctx.fillStyle = '#04121c';
  ctx.fillRect(x1 - cl - 1, cy - W * .44, 2, W * .88);
  ctx.globalAlpha = 1;
  // fifth wheel + king pin (rear)
  fillRR(ctx, x0 + bl * .02, cy - W * .30, bl * .30, W * .60, 2, '#4b5863');
  ctx.fillStyle = '#2b333b';
  ctx.beginPath(); ctx.arc(x0 + bl * .17, cy, ppu * .13, 0, TAU); ctx.fill();
  // fuel tank + steps
  fillRR(ctx, x0 + bl * .38, cy - W * .42, bl * .16, W * .18, 1.6, '#5b6874');
  fillRR(ctx, x0 + bl * .38, cy + W * .24, bl * .16, W * .18, 1.6, '#5b6874');
  // wheels
  wheel(ctx, x1 - cl * .82, cy - W * .46, ppu * .27);
  wheel(ctx, x1 - cl * .82, cy + W * .46, ppu * .27);
  wheel(ctx, x1 - cl * .22, cy - W * .46, ppu * .27);
  wheel(ctx, x1 - cl * .22, cy + W * .46, ppu * .27);
  beacon(ctx, x1 - cl * .5, cy - W * .40, ppu * .1);
}

/* ------------------------------------------------------- STRADDLE (later) -- */
/** Straddle carrier: narrow portal, carries the container along its own axis. */
function drawStraddle(ctx, L, W, ppu) {
  const cx = L * .5, cy = W * .5;
  const frameT = ppu * .40;
  const legW = ppu * .40;
  const x0 = ppu * .25, x1 = L - ppu * .25;
  const yA = ppu * .22, yB = W - ppu * .22 - frameT;

  // ground footprint shadow
  ctx.globalAlpha = .16; ctx.fillStyle = '#04141f';
  fillRR(ctx, x0, cy - W * .5, x1 - x0, W, 3, '#04141f');
  ctx.globalAlpha = 1;

  // top frame rails (run along X on both sides)
  for (const gy of [yA, yB]) {
    fillRR(ctx, x0, gy, x1 - x0, frameT, 2,
      grad(ctx, 0, gy, 0, gy + frameT, [[0, '#41bd83'], [.5, '#1f8a54'], [1, '#125c35']]));
    ctx.globalAlpha = .32; ctx.fillStyle = '#eafff3';
    ctx.fillRect(x0 + 2, gy + frameT * .2, x1 - x0 - 4, Math.max(1, frameT * .12));
    ctx.globalAlpha = 1;
  }
  // corner legs + wheels
  for (const lx of [x0, x1 - legW]) {
    for (const ly of [yA, yB]) {
      fillRR(ctx, lx, ly, legW, frameT, 1.4, '#1c7048');
      wheel(ctx, lx + legW * .5 - ppu * .26, ly + frameT * .5, ppu * .24);
      wheel(ctx, lx + legW * .5 + ppu * .26, ly + frameT * .5, ppu * .24);
    }
  }
  // transverse cross beams
  ctx.globalAlpha = .55; ctx.fillStyle = '#166b41';
  fillRR(ctx, x0 + (x1 - x0) * .18, yA, ppu * .34, yB - yA + frameT, 1.2, '#17794a');
  fillRR(ctx, x0 + (x1 - x0) * .72, yA, ppu * .34, yB - yA + frameT, 1.2, '#17794a');
  ctx.globalAlpha = 1;
  // machine house + cab at the rear
  fillRR(ctx, x0 + ppu * .1, cy - W * .30, ppu * 1.5, W * .60, 2.4,
    grad(ctx, 0, cy - W * .30, 0, cy + W * .30, [[0, '#f3f9fc'], [1, '#c6d8e3']]));
  ctx.fillStyle = PALETTE.cabinGlass;
  fillRR(ctx, x0 + ppu * .2, cy - W * .22, ppu * .5, W * .44, 1.6, PALETTE.cabinGlass);
  // hoist winch housing
  fillRR(ctx, x0 + ppu * 1.5, cy - W * .18, ppu * .9, W * .36, 1.6, '#41505a');
  beacon(ctx, x1 - ppu * .4, cy - W * .34, ppu * .12);
}

/* ------------------------------------------------------- DYNAMIC PARTS ---- */
/**
 * Draw the moving parts of a machine in the vehicle's local frame.
 * The renderer calls this after the chassis sprite so booms, trolleys,
 * spreaders and forks appear on top and animate.
 *
 * state = {
 *   forkSpread, forkHeight,       // forklift
 *   boomExtend 0..1, boomAngle,   // reach stacker / harbour crane (radians, 0 = forward)
 *   trolleyPos -1..1, hoistHeight,// RTG / harbour crane
 *   hoistSpread                   // spreader length (m) for 20/40 ft
 * }
 */
export function drawAttachment(ctx, type, st = {}, ppu = SPRITE_PPU, dims = {}) {
  const L = dims.L || 0, W = dims.W || 0;
  const cy = W * .5;

  if (type === 'forklift') {
    const spread = clamp(st.forkSpread ?? 1, .4, 1.25);
    const forkLen = L * .30, tw = Math.max(2.2, ppu * .15);
    const mx = L * .62;                                  // mast line
    // fork carriage plate (rides the mast)
    ctx.fillStyle = '#333f49';
    fillRR(ctx, mx + ppu * .24, cy - W * .44, ppu * .2, W * .88, 1.2, '#333f49');
    // two tines pointing +X
    for (const s of [-1, 1]) {
      const fy = cy + s * spread * W * .19 - tw * .5;
      fillRR(ctx, mx + ppu * .44, fy, forkLen, tw, 1,
        grad(ctx, 0, fy, 0, fy + tw, [[0, '#d3dce3'], [.5, '#aab6c0'], [1, '#7c8993']]));
      // tapered tip
      ctx.fillStyle = '#8f9ba5';
      fillRR(ctx, mx + ppu * .44 + forkLen, fy + tw * .2, ppu * .09, tw * .6, .8, '#8f9ba5');
    }
    // backrest behind the carriage
    ctx.fillStyle = '#5a6771';
    ctx.fillRect(mx + ppu * .18, cy - W * .40, ppu * .07, W * .8);
    return;
  }

  if (type === 'reachstacker') {
    const ext = clamp01(st.boomExtend ?? 0);
    const angle = st.boomAngle ?? 0;
    const pivotX = L * .56, pivotY = cy;
    const baseLen = L * .42, teleLen = L * .58 * ext;
    const boomW = ppu * .42;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    // main boom
    const total = baseLen + teleLen;
    fillRR(ctx, 0, -boomW * .5, total, boomW, 1.8,
      grad(ctx, 0, -boomW * .5, 0, boomW * .5, [[0, '#ffe377'], [.45, '#f0c62f'], [1, '#c09512']]));
    ctx.globalAlpha = .28; ctx.fillStyle = '#fff';
    ctx.fillRect(3, -boomW * .30, total - 6, Math.max(1, boomW * .12));
    ctx.globalAlpha = 1;
    // telescopic sleeve
    fillRR(ctx, baseLen - 2, -boomW * .42, Math.max(2, teleLen + 2), boomW * .84, 1.4, '#d9b220');
    ctx.globalAlpha = .3; ctx.fillStyle = '#fff';
    ctx.fillRect(baseLen, -boomW * .34, Math.max(2, teleLen - 3), Math.max(1, boomW * .1));
    ctx.globalAlpha = 1;
    // hydraulic ram
    ctx.fillStyle = PALETTE.hyd;
    fillRR(ctx, baseLen * .18, -boomW * .78, total * .58, boomW * .34, 1.2, PALETTE.hyd);
    ctx.fillStyle = PALETTE.hydLight;
    fillRR(ctx, total * .55, -boomW * .72, total * .28, boomW * .22, 1, PALETTE.hydLight);

    // spreader head at the boom tip — container long axis follows the boom
    const spL = (st.spreaderLength ?? 40) === 40 ? ppu * 1.55 : ppu * .8;   // along the boom (X)
    const spW = ppu * .95;                                                  // across (Y)
    const sx = total;
    ctx.fillStyle = '#2b3740';
    fillRR(ctx, sx - spL * .5 - 1, -spW * .5 - 1, spL + 2, spW + 2, 1.4, '#2b3740');
    fillRR(ctx, sx - spL * .5, -spW * .5, spL, spW, 1.2,
      grad(ctx, 0, -spW * .5, 0, spW * .5, [[0, '#98a5b0'], [1, '#4f5c67']]));
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(sx - spL * .5, -spW * .5, Math.max(1.4, ppu * .1), spW);
    ctx.fillRect(sx + spL * .5 - Math.max(1.4, ppu * .1), -spW * .5, Math.max(1.4, ppu * .1), spW);
    // twistlocks at the corners
    ctx.fillStyle = '#ffb020';
    for (const dx of [-spL * .38, spL * .38]) {
      for (const dy of [-spW * .30, spW * .30]) {
        ctx.beginPath(); ctx.arc(sx + dx, dy, Math.max(1, ppu * .07), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  if (type === 'rtg') {
    const t = clamp(st.trolleyPos ?? .25, -1, 1);           // -1..1 across the span (Y)
    const cx = L * .5, cym = W * .5;
    const girderT = ppu * .40;
    const base = L * .62;
    const gx0 = cx - base * .5, gx1 = cx + base * .5;
    const y0 = ppu * .30 + girderT * .5, y1 = W - ppu * .30 - girderT * .5;
    const ty = y0 + (t * .5 + .5) * (y1 - y0);

    // ---- trolley: a carriage bridging both girders -----------------------
    const tl = base + girderT * 2.2;                        // length along X
    const tw = ppu * .52;                                   // width along Y
    fillRR(ctx, cx - tl * .5, ty - tw * .5, tl, tw, 1.4,
      grad(ctx, 0, ty - tw * .5, 0, ty + tw * .5, [[0, '#5c6a76'], [.5, '#3a4753'], [1, '#2b3740']]));
    ctx.globalAlpha = .35; ctx.fillStyle = '#c9d7e0';
    ctx.fillRect(cx - tl * .5 + 2, ty - tw * .5 + 1.2, tl - 4, Math.max(1, tw * .16));
    ctx.globalAlpha = 1;
    // trolley end plates riding the rails
    for (const gX of [gx0, gx1]) {
      fillRR(ctx, gX - girderT * .66, ty - tw * .62, girderT * 1.32, tw * 1.24, 1.2, '#39454f');
      ctx.fillStyle = '#1b2228';
      for (const dx of [-girderT * .34, girderT * .34]) {
        ctx.beginPath(); ctx.arc(gX + dx, ty, ppu * .12, 0, TAU); ctx.fill();
      }
    }
    // hoist drum on the trolley
    ctx.fillStyle = '#28323b';
    fillRR(ctx, cx - ppu * .18, ty - ppu * .16, ppu * .36, ppu * .32, 1, '#28323b');

    // ---- hoist cables + spreader frame ----------------------------------
    const lift = clamp01(st.hoistHeight ?? .22);
    const drop = ppu * .40 + lift * (W * .40);
    const spL = (st.spreaderLength ?? 40) === 40 ? L * .78 : L * .44;   // along X
    const spW = ppu * 1.15;                                             // along Y
    const spY = ty + drop;
    ctx.globalAlpha = .75; ctx.strokeStyle = '#1d2934'; ctx.lineWidth = Math.max(1, ppu * .07);
    for (const dx of [-spL * .40, spL * .40]) {
      for (const dy of [-spW * .42, spW * .42]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * .55, ty + dy * .5);
        ctx.lineTo(cx + dx, spY + dy);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // spreader
    fillRR(ctx, cx - spL * .5 - 1, spY - spW * .5 - 1, spL + 2, spW + 2, 1.6, '#2b3740');
    fillRR(ctx, cx - spL * .5, spY - spW * .5, spL, spW, 1.4,
      grad(ctx, 0, spY - spW * .5, 0, spY + spW * .5, [[0, '#98a5b0'], [.5, '#68757f'], [1, '#414d58']]));
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(cx - spL * .5, spY - spW * .5, Math.max(1.6, ppu * .12), spW);
    ctx.fillRect(cx + spL * .5 - Math.max(1.6, ppu * .12), spY - spW * .5, Math.max(1.6, ppu * .12), spW);
    ctx.fillStyle = '#ffb020';
    for (const sx of [-spL * .42, spL * .42]) {
      for (const sy of [-spW * .30, spW * .30]) {
        ctx.beginPath(); ctx.arc(cx + sx, spY + sy, Math.max(1, ppu * .08), 0, TAU); ctx.fill();
      }
    }
    return;
  }

  if (type === 'harborcrane') {
    const pivotX = dims.pivotX ?? L * .46, pivotY = cy;
    const angle = st.boomAngle ?? 0;
    const reel = clamp01(st.boomExtend ?? .35);           // 0 = luffed up, 1 = extended
    const boomLen = (L * .5) + (L * .85) * reel;
    const boomW = ppu * .46;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    // lattice boom
    fillRR(ctx, 0, -boomW * .5, boomLen, boomW, 1.4,
      grad(ctx, 0, -boomW * .5, 0, boomW * .5, [[0, '#ffe377'], [.5, '#eec32c'], [1, '#b98f0d']]));
    ctx.save();
    rr(ctx, 0, -boomW * .5, boomLen, boomW, 1.4); ctx.clip();
    ctx.globalAlpha = .5; ctx.strokeStyle = '#6b5007'; ctx.lineWidth = .9;
    for (let i = 2; i < boomLen - 2; i += ppu * .8) {
      ctx.beginPath(); ctx.moveTo(i, -boomW * .5); ctx.lineTo(i + ppu * .4, boomW * .5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + ppu * .4, -boomW * .5); ctx.lineTo(i, boomW * .5); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalAlpha = .3; ctx.fillStyle = '#fff';
    ctx.fillRect(2, -boomW * .30, boomLen - 4, Math.max(1, boomW * .12));
    ctx.globalAlpha = 1;
    // hoist trolley on the boom + hook block hanging from it
    const hx = boomLen * clamp01(st.hoistHeight ?? .8);
    fillRR(ctx, hx - ppu * .35, -boomW * .85, ppu * .7, boomW * 1.7, 1.2, '#2f3b45');
    ctx.globalAlpha = .7; ctx.strokeStyle = '#101c25'; ctx.lineWidth = Math.max(1, ppu * .06);
    ctx.beginPath(); ctx.moveTo(hx, boomW * .5); ctx.lineTo(hx, boomW * .5 + ppu * (st.hookDrop ?? .6)); ctx.stroke();
    ctx.globalAlpha = 1;
    const hookY = boomW * .5 + ppu * (st.hookDrop ?? .6);
    ctx.fillStyle = '#2b3740';
    fillRR(ctx, hx - ppu * .42, hookY - ppu * .34, ppu * .84, ppu * .68, 1.4, '#2f3b45');
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(hx - ppu * .46, hookY - ppu * .38, ppu * .92, Math.max(1.4, ppu * .1));
    ctx.restore();
    return;
  }

  if (type === 'tractor') return;   // no moving parts beyond the trailer
}

/* ---------------------------------------------------------------- registry */
/** footprint: w = metres across (Y), l = metres along (X, forward). */
const DRAWERS = {
  forklift: { fn: drawForklift, fp: { w: 2.7, l: 5.3 } },
  reachstacker: { fn: drawReachStacker, fp: { w: 4.8, l: 11.4 } },
  rtg: { fn: drawRTG, fp: { w: 13.6, l: 8.4 } },
  harborcrane: { fn: drawHarborCrane, fp: { w: 6.0, l: 10.4 } },
  tractor: { fn: drawTractor, fp: { w: 2.6, l: 7.0 } },
  straddle: { fn: drawStraddle, fp: { w: 4.2, l: 7.4 } }
};

export function machineFootprint(type) { return DRAWERS[type]?.fp || { w: 2, l: 4 }; }

/** Baked chassis sprite (no dynamic parts). Local frame: +X forward. */
export function machineSprite(type) {
  const def = DRAWERS[type];
  if (!def) throw new Error(`Unknown machine sprite: ${type}`);
  return machine(type, def);
}

/** Convenience: draw chassis + dynamic parts in one call (used by previews). */
export function drawMachine(ctx, type, st = {}, x = 0, y = 0, angle = 0, scale = 1) {
  const sp = machineSprite(type);
  const dims = { L: sp.l * sp.ppu, W: sp.w * sp.ppu };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = (ctx.globalAlpha ?? 1) * .45;
  ctx.drawImage(sp.shadow, -sp.drawW / 2 + 6, -sp.drawH / 2 + 7, sp.drawW, sp.drawH);
  ctx.globalAlpha = (ctx.globalAlpha ?? 1) / .45;
  ctx.drawImage(sp.canvas, -sp.drawW / 2, -sp.drawH / 2, sp.drawW, sp.drawH);
  ctx.translate(-sp.drawW / 2 + sp.pad, -sp.drawH / 2 + sp.pad);
  drawAttachment(ctx, type, st, sp.ppu, dims);
  ctx.restore();
}

/** White silhouette used for "ghost" previews (placement validation). */
export function silhouetteOf(type, color = 'rgba(34,200,184,.5)') {
  const key = `sil_${type}_${color}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const src = machineSprite(type).canvas;
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const out = { canvas, w: src.width, h: src.height };
  containerCache.set(key, out);
  return out;
}

/* ====================================================================== */
/*  PORT MENTOR PORTRAIT                                                  */
/* ====================================================================== */

/**
 * The Port Mentor — "Sam Kowalski", senior terminal supervisor.
 * Hard hat, hi-vis vest, friendly professional expression. Drawn once at
 * 256×256 and reused as the UI portrait everywhere.
 */
export function mentorPortrait(size = 256) {
  const key = `mentor_${size}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const { canvas, ctx } = makeCanvas(size, size);
  const S = size / 256;
  ctx.save();
  ctx.scale(S, S);

  // backdrop: quay + sky shimmer
  const bg = ctx.createLinearGradient(0, 0, 0, 256);
  bg.addColorStop(0, '#134a6b'); bg.addColorStop(.55, '#0d3550'); bg.addColorStop(1, '#08243a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 256);
  ctx.globalAlpha = .18; ctx.fillStyle = '#22c8b8';
  ctx.beginPath(); ctx.moveTo(0, 196); ctx.lineTo(256, 168); ctx.lineTo(256, 256); ctx.lineTo(0, 256); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = .12; ctx.strokeStyle = '#bfe6ff'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, 24 + i * 9); ctx.lineTo(256, 12 + i * 9); ctx.stroke(); }
  // stacked containers silhouette
  ctx.globalAlpha = .3;
  const cols = ['#1b6aa5', '#d0562b', '#0f9d8e', '#c9424b', '#f0b429'];
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) {
    ctx.fillStyle = cols[(r * 3 + c2) % cols.length];
    ctx.fillRect(6 + c2 * 30 + r * 4, 150 + r * 14, 26, 12);
  }
  ctx.globalAlpha = 1;

  // shoulders / hi-vis jacket
  ctx.beginPath();
  ctx.moveTo(38, 256); ctx.quadraticCurveTo(46, 196, 96, 184);
  ctx.lineTo(160, 184); ctx.quadraticCurveTo(210, 196, 218, 256); ctx.closePath();
  const vest = ctx.createLinearGradient(38, 184, 218, 256);
  vest.addColorStop(0, '#f6c515'); vest.addColorStop(.5, '#ffd83d'); vest.addColorStop(1, '#dcae0b');
  ctx.fillStyle = vest; ctx.fill();
  // vest reflective bands
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(38, 256); ctx.quadraticCurveTo(46, 196, 96, 184);
  ctx.lineTo(160, 184); ctx.quadraticCurveTo(210, 196, 218, 256); ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(238,246,252,.92)'; ctx.fillRect(0, 214, 256, 9);
  ctx.fillStyle = 'rgba(190,205,216,.75)'; ctx.fillRect(0, 230, 256, 5);
  ctx.fillStyle = 'rgba(30,44,56,.5)'; ctx.fillRect(118, 184, 20, 72);
  ctx.restore();
  // navy work shirt under the vest
  ctx.beginPath(); ctx.moveTo(104, 190); ctx.lineTo(128, 214); ctx.lineTo(152, 190); ctx.closePath();
  ctx.fillStyle = '#16374f'; ctx.fill();

  // neck
  ctx.fillStyle = '#d79a72'; ctx.fillRect(112, 168, 32, 24);
  ctx.fillStyle = 'rgba(120,60,30,.28)'; ctx.fillRect(112, 168, 32, 8);

  // head
  ctx.beginPath(); ctx.ellipse(128, 128, 44, 50, 0, 0, TAU);
  ctx.fillStyle = '#e3a97c'; ctx.fill();
  // jaw shading
  ctx.globalAlpha = .16; ctx.fillStyle = '#8a4f28';
  ctx.beginPath(); ctx.ellipse(128, 160, 32, 20, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // ears
  ctx.fillStyle = '#dda074';
  ctx.beginPath(); ctx.ellipse(84, 132, 8, 12, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(172, 132, 8, 12, 0, 0, TAU); ctx.fill();

  // safety glasses / eyes
  const eyeY = 124;
  ctx.fillStyle = '#25313b';
  ctx.beginPath(); ctx.ellipse(110, eyeY, 6.5, 5.2, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(146, eyeY, 6.5, 5.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.arc(112.5, eyeY - 2, 2.1, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(148.5, eyeY - 2, 2.1, 0, TAU); ctx.fill();
  // friendly brows
  ctx.strokeStyle = '#5d3a1d'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(101, 111); ctx.quadraticCurveTo(110, 106, 119, 110); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(137, 110); ctx.quadraticCurveTo(146, 106, 155, 111); ctx.stroke();
  // nose + smile
  ctx.strokeStyle = 'rgba(150,80,40,.6)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(128, 132); ctx.lineTo(126, 146); ctx.quadraticCurveTo(130, 150, 134, 146); ctx.stroke();
  ctx.strokeStyle = '#8c4326'; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(112, 158); ctx.quadraticCurveTo(128, 168, 144, 157); ctx.stroke();
  // stubble hint
  ctx.globalAlpha = .12; ctx.fillStyle = '#3d2a1a';
  ctx.beginPath(); ctx.ellipse(128, 156, 26, 18, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  // hair peeking out under the hat
  ctx.fillStyle = '#3b2a1c';
  ctx.beginPath(); ctx.ellipse(128, 96, 46, 22, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
  // hard hat — dome sits *on* the head, brim above the brow
  const hatTopY = 62;
  ctx.beginPath();
  ctx.ellipse(128, 92, 41, 33, 0, Math.PI, 0);
  ctx.closePath();
  const hat = ctx.createLinearGradient(88, hatTopY, 170, 96);
  hat.addColorStop(0, '#ffdf78'); hat.addColorStop(.45, '#f7c62f'); hat.addColorStop(1, '#cf9a10');
  ctx.fillStyle = hat; ctx.fill();
  // subtle crown ridge
  ctx.globalAlpha = .22; ctx.strokeStyle = '#8d660a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(128, hatTopY + 2); ctx.lineTo(128, 90); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(104, hatTopY + 8); ctx.quadraticCurveTo(110, 80, 111, 90); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(152, hatTopY + 8); ctx.quadraticCurveTo(146, 80, 145, 90); ctx.stroke();
  ctx.globalAlpha = 1;
  // brim
  ctx.beginPath(); ctx.ellipse(128, 93, 47, 9.5, 0, 0, TAU); ctx.fillStyle = '#e0a91a'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(128, 91, 41, 6, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill();
  // logo badge on the crown
  ctx.beginPath(); ctx.ellipse(128, 74, 13, 9.5, 0, 0, TAU);
  ctx.fillStyle = '#0b2337'; ctx.fill();
  ctx.fillStyle = '#22c8b8'; ctx.font = '700 11px "Segoe UI",system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PO', 128, 75);
  // rim light on the crown
  ctx.globalAlpha = .45; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(110, 74, 11, 5, -.45, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  // radio on the vest strap
  ctx.fillStyle = '#1c2733';
  fillRR(ctx, 168, 206, 18, 26, 4, '#1c2733');
  ctx.fillStyle = '#2c3a47';
  fillRR(ctx, 171, 209, 12, 8, 2, '#2c3a47');
  ctx.fillStyle = '#22c8b8';
  ctx.beginPath(); ctx.arc(177, 222, 3.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#1c2733'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(182, 208); ctx.lineTo(192, 190); ctx.stroke();

  ctx.restore();
  const out = { canvas, size };
  containerCache.set(key, out);
  return out;
}

/* ====================================================================== */
/*  UI / ICONS                                                            */
/* ====================================================================== */

/**
 * Small machine thumbnail for HUD + mission cards.
 * Long machines (reach stacker, RTG) are cropped around their working end so
 * the silhouette stays readable at 40–60 px.
 */
const THUMB_FOCUS = { reachstacker: 0.34, rtg: 0.5, harborcrane: 0.62, tractor: 0.42, straddle: 0.5, forklift: 0.42 };
export function machineThumb(type, w = 76, h = 56) {
  const key = `thumb_${type}_${w}_${h}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const sp = machineSprite(type);
  const { canvas, ctx } = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0e3049'); g.addColorStop(1, '#071c2d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // faint quay-line texture
  ctx.globalAlpha = .16; ctx.strokeStyle = '#2b8fc4'; ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 9) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const scale = Math.max((w - 6) / sp.canvas.width, (h - 6) / sp.canvas.height);
  const dw = sp.canvas.width * scale, dh = sp.canvas.height * scale;
  const focus = THUMB_FOCUS[type] ?? 0.5;
  const offX = (w - dw) * focus;             // bias the crop toward the working end
  const offY = (h - dh) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.globalAlpha = .35; ctx.drawImage(sp.shadow, offX + 3, offY + 3, dw, dh);
  ctx.globalAlpha = 1; ctx.drawImage(sp.canvas, offX, offY, dw, dh);
  ctx.restore();
  ctx.globalAlpha = .25; ctx.strokeStyle = '#22c8b8'; ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, w - 1, h - 1);
  ctx.globalAlpha = 1;
  const out = { canvas };
  containerCache.set(key, out);
  return out;
}

/** Port logo mark used on the boot screen and main menu. */
export function brandMark(size = 128) {
  const key = `brand_${size}`;
  if (containerCache.has(key)) return containerCache.get(key);
  const { canvas, ctx } = makeCanvas(size, size);
  const s = size / 128;
  ctx.scale(s, s);
  // shield
  ctx.beginPath();
  ctx.moveTo(64, 6); ctx.lineTo(116, 26); ctx.lineTo(116, 70);
  ctx.quadraticCurveTo(116, 106, 64, 122); ctx.quadraticCurveTo(12, 106, 12, 70);
  ctx.lineTo(12, 26); ctx.closePath();
  const g = ctx.createLinearGradient(12, 6, 116, 122);
  g.addColorStop(0, '#17506f'); g.addColorStop(1, '#0a2a42');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(34,200,184,.55)'; ctx.lineWidth = 2.5; ctx.stroke();
  // gantry crane glyph
  ctx.strokeStyle = '#22c8b8'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, 88); ctx.lineTo(30, 40); ctx.lineTo(94, 40); ctx.lineTo(94, 88);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(34, 40); ctx.lineTo(90, 40); ctx.stroke();
  ctx.strokeStyle = '#ffc53d';
  ctx.beginPath(); ctx.moveTo(62, 40); ctx.lineTo(62, 64); ctx.stroke();
  // hanging container
  ctx.fillStyle = '#2b8fc4';
  fillRR(ctx, 50, 64, 24, 12, 2, '#2b8fc4');
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(52, 66, 20, 2);
  // wave base
  ctx.strokeStyle = 'rgba(147,190,220,.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(24, 98); ctx.quadraticCurveTo(40, 92, 56, 98); ctx.quadraticCurveTo(72, 104, 88, 98); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(32, 107); ctx.quadraticCurveTo(48, 101, 64, 107); ctx.stroke();
  const out = { canvas };
  containerCache.set(key, out);
  return out;
}

export function clearSpriteCache() { containerCache.clear(); machineCache.clear(); }
export const spriteCacheSize = () => containerCache.size + machineCache.size;

/** Namespace export so systems can `import { SpriteFactory } from ...`. */
export const SpriteFactory = {
  machineSprite, machineThumb, machineFootprint, drawMachine, drawAttachment,
  containerSprite, palletSprite, crateSprite, silhouetteOf,
  mentorPortrait, brandMark, clearSpriteCache, spriteCacheSize,
  SPRITE_PPU, CARGO_PPU, CONTAINER_LIVERS
};
