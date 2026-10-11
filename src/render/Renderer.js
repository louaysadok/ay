/**
 * Renderer.js — composes every visible frame.
 *
 * Order: water → baked ground → quay furniture & ships → buildings → yard
 * stacks → y-sorted dynamic entities (machines, trucks, people, cargo) →
 * world overlays (markers, guidance, restricted zones, ghosts).
 *
 * Everything is culled against the camera rectangle, and all per-frame work is
 * plain drawImage/rect calls — no filters, no shadow blurs, no offscreen
 * compositing beyond two blits.
 */
import { SpriteFactory as SF, SPRITE_PPU, CARGO_PPU } from './SpriteFactory.js';
import { clamp, rgba, TAU, smoothstep, easeOutCubic, dist } from '../engine/Utils.js';

const SHADOW_DX = 3.1, SHADOW_DY = 4.0;   // fixed sun direction (SE)

export class Renderer {
  constructor(canvas, deps) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.terminal = deps.terminal;
    this.camera = deps.camera;
    this.terrain = deps.terrain;
    this.bus = deps.bus;
    this.quality = deps.quality || 'high';
    this.width = 0; this.height = 0; this.dpr = 1;
    this.time = 0;
    this.wavePhase = 0;
    this.showZones = false;
    this.showGhost = true;
    this.zoneHighlight = null;
    this.markers = [];
    this.fps = 60;
  }

  resize(w, h, dpr) {
    this.width = w; this.height = h;
    this.dpr = Math.min(dpr || 1, this.quality === 'low' ? 1 : 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.resize(w, h);
  }

  /* ===================================================================== */
  render(dt, state) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.time += dt;
    this.wavePhase += dt;
    const shake = cam.shakeOffset;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // base backdrop (also what shows through above the terminal perimeter)
    ctx.fillStyle = '#061a2b';
    ctx.fillRect(0, 0, this.width, this.height);

    // world transform
    ctx.save();
    ctx.translate(this.width / 2 + shake.x * cam.zoom, this.height / 2 + shake.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const view = cam.viewRect(6);
    this.view = view;

    this.drawWater(ctx, view);
    this.drawGround(ctx, view);
    this.drawQuay(ctx, view);
    this.drawShips(ctx, view);
    this.drawBuildings(ctx, view);
    this.drawYardZones(ctx, view);
    this.drawStacks(ctx, view);
    this.drawDynamic(ctx, view, state);
    this.drawOverlays(ctx, view, state);

    ctx.restore();

    // screen-space vignette / edge darkening handled by CSS (#stage-shade)
    if (state.fade != null && state.fade > 0) {
      ctx.fillStyle = `rgba(3,10,18,${state.fade})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  /* ------------------------------------------------------------------ water */
  drawWater(ctx, view) {
    const waterH = this.terminal.waterLine;
    if (view.y > waterH) return;
    const x0 = Math.max(0, view.x), x1 = Math.min(this.terminal.bounds.w, view.x + view.w);
    // animated swell lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, waterH);
    ctx.clip();
    const t = this.wavePhase;
    ctx.strokeStyle = 'rgba(190,230,255,.14)';
    ctx.lineWidth = 1.4 / this.camera.zoom;
    const rows = 16;
    for (let i = 0; i < rows; i++) {
      const baseY = 3 + (i / rows) * (waterH - 5);
      const amp = 0.55 + (i % 3) * 0.22;
      const speed = 0.35 + (i % 4) * 0.08;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 4) {
        const y = baseY + Math.sin((x * 0.06) + t * speed + i) * amp;
        if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // lighter foam near the quay wall
    ctx.strokeStyle = 'rgba(220,240,250,.22)';
    ctx.lineWidth = 2.4 / this.camera.zoom;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 3) {
      const y = waterH - 1.6 + Math.sin(x * 0.22 + t * 1.2) * 0.34;
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // deep-water shimmer
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#bfe9ff';
    for (let i = 0; i < 14; i++) {
      const x = x0 + ((i * 37 + (t * 6) % 40) % Math.max(1, x1 - x0));
      const y = 6 + ((i * 13) % Math.max(1, waterH - 10));
      ctx.beginPath();
      ctx.ellipse(x, y, 2.4, 0.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------------- ground */
  drawGround(ctx, view) {
    const img = this.terrain.canvas;
    const s = this.terrain.ppu;
    const sx = clamp(view.x * s, 0, img.width);
    const sy = clamp(view.y * s, 0, img.height);
    const sw = clamp(view.w * s, 0, img.width - sx);
    const sh = clamp(view.h * s, 0, img.height - sy);
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(img, sx, sy, sw, sh, sx / s, sy / s, sw / s, sh / s);
  }

  /* -------------------------------------------------------------------- quay */
  drawQuay(ctx, view) {
    const T = this.terminal;
    // ship-to-shore gantry cranes (static scenery with a slow sway)
    for (const crane of T.layout.shipToShoreCranes) {
      if (crane.x + 30 < view.x || crane.x - 30 > view.x + view.w) continue;
      this.drawSTS(ctx, crane);
    }
    // mooring lines from the ships to the quay bollards
    ctx.save();
    ctx.strokeStyle = 'rgba(230,238,244,.35)';
    ctx.lineWidth = 0.16;
    for (const ship of T.ships) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(ship.x + s * ship.length * 0.38, ship.y + ship.beam * 0.35);
        ctx.lineTo(ship.x + s * (ship.length * 0.38 + 7), T.waterLine - 1.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawSTS(ctx, crane) {
    const baseY = crane.y ?? this.terminal.waterLine;
    const railSpan = crane.railSpan;
    const boomLen = crane.reach;
    ctx.save();
    // shadow on the ground
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#03121c';
    ctx.fillRect(crane.x - 12 + 4, baseY + 4 + 3, 24, railSpan);
    ctx.globalAlpha = 1;

    // portal legs (two rows of two)
    const legR = 0.85;
    for (const ly of [baseY + 6, baseY + 6 + railSpan]) {
      for (const lx of [crane.x - 7.5, crane.x + 7.5]) {
        ctx.fillStyle = '#3f4d58';
        ctx.beginPath(); ctx.arc(lx, ly, legR, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5d6b78';
        ctx.beginPath(); ctx.arc(lx, ly, legR * 0.55, 0, TAU); ctx.fill();
      }
    }
    // portal frame
    const frameGrad = ctx.createLinearGradient(crane.x - 8, 0, crane.x + 8, 0);
    frameGrad.addColorStop(0, '#2d5f7f'); frameGrad.addColorStop(.5, '#4a8cae'); frameGrad.addColorStop(1, '#255a78');
    ctx.fillStyle = frameGrad;
    ctx.fillRect(crane.x - 8, baseY + 5.4, 16, 1.3);
    ctx.fillRect(crane.x - 8, baseY + 5 + railSpan, 16, 1.3);
    ctx.fillRect(crane.x - 8, baseY + 5.4, 1.1, railSpan + 1.3);
    ctx.fillRect(crane.x + 6.9, baseY + 5.4, 1.1, railSpan + 1.3);

    // boom reaching over the ship
    ctx.save();
    ctx.translate(crane.x, baseY + 4.4);
    const boomGrad = ctx.createLinearGradient(0, -boomLen, 0, 0);
    boomGrad.addColorStop(0, '#f0c62f'); boomGrad.addColorStop(.55, '#d9a71c'); boomGrad.addColorStop(1, '#b98c10');
    ctx.fillStyle = boomGrad;
    ctx.fillRect(-1.5, -boomLen, 3, boomLen + 2);
    // lattice hints
    ctx.globalAlpha = .35; ctx.strokeStyle = '#6b5007'; ctx.lineWidth = 0.16;
    for (let i = -boomLen + 1; i < 0; i += 2.4) {
      ctx.beginPath(); ctx.moveTo(-1.4, i); ctx.lineTo(1.4, i + 1.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1.4, i); ctx.lineTo(-1.4, i + 1.2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // trolley + spreader + a hanging container near the ship
    const trolleyY = -boomLen * 0.62 + Math.sin(this.wavePhase * .5) * 0.3;
    ctx.fillStyle = '#37444f';
    ctx.fillRect(-2.6, trolleyY - 1.2, 5.2, 2.4);
    ctx.fillStyle = '#56636f';
    ctx.fillRect(-2.0, trolleyY - .9, 4, 1.8);
    ctx.strokeStyle = 'rgba(20,32,40,.6)'; ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.moveTo(0, trolleyY + 1.2); ctx.lineTo(0, trolleyY + 5.2); ctx.stroke();
    ctx.fillStyle = '#2c3843';
    ctx.fillRect(-2.6, trolleyY + 5.2, 5.2, 1.7);
    ctx.fillStyle = '#ffc53d';
    ctx.fillRect(-2.7, trolleyY + 5.1, 5.4, 0.34);
    ctx.restore();

    // machinery house behind the portal
    ctx.fillStyle = '#e6eef4';
    ctx.fillRect(crane.x - 5.5, baseY + railSpan + 1.4, 11, 5.2);
    ctx.fillStyle = 'rgba(30,50,66,.25)';
    ctx.fillRect(crane.x - 5.5, baseY + railSpan + 1.4, 11, 1);
    ctx.fillStyle = '#37444f';
    ctx.fillRect(crane.x - 4.6, baseY + railSpan + 2.2, 3.4, 2.8);
    // beacon
    const pulse = 0.5 + 0.5 * Math.sin(this.wavePhase * 3.2);
    ctx.globalAlpha = 0.25 + pulse * 0.5;
    ctx.fillStyle = '#ffb020';
    ctx.beginPath(); ctx.arc(crane.x + 6.2, baseY + railSpan + 2, 0.9, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ------------------------------------------------------------------- ships */
  drawShips(ctx, view) {
    for (const ship of this.terminal.ships) {
      if (ship.x + ship.length < view.x - 20 || ship.x - ship.length > view.x + view.w) continue;
      this.drawShip(ctx, ship);
    }
  }

  drawShip(ctx, ship) {
    const L = ship.length, B = ship.beam;
    const x0 = ship.x - L / 2, y0 = ship.y - B / 2;
    ctx.save();
    // shadow in the water
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#04141f';
    this.roundRect(ctx, x0 + 1.6, y0 + 1.8, L, B + 1.5, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    // hull: rounded box with a tapered bow (+X is the bow)
    ctx.beginPath();
    const bowTaper = 0.12;
    ctx.moveTo(x0 + 3, y0);
    ctx.lineTo(x0 + L * (1 - bowTaper), y0);
    ctx.quadraticCurveTo(x0 + L, y0, x0 + L, y0 + B / 2);
    ctx.quadraticCurveTo(x0 + L, y0 + B, x0 + L * (1 - bowTaper), y0 + B);
    ctx.lineTo(x0 + 3, y0 + B);
    ctx.quadraticCurveTo(x0, y0 + B, x0, y0 + B / 2);
    ctx.quadraticCurveTo(x0, y0, x0 + 3, y0);
    ctx.closePath();
    const hullGrad = ctx.createLinearGradient(0, y0, 0, y0 + B);
    hullGrad.addColorStop(0, '#1a5a80');
    hullGrad.addColorStop(.12, ship.hullColor);
    hullGrad.addColorStop(.5, ship.deckColor);
    hullGrad.addColorStop(.9, ship.hullColor);
    hullGrad.addColorStop(1, '#0e3550');
    ctx.fillStyle = hullGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(3,16,25,.55)';
    ctx.lineWidth = 0.4;
    ctx.stroke();

    // deck plating
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + 3, y0);
    ctx.lineTo(x0 + L * (1 - bowTaper), y0);
    ctx.quadraticCurveTo(x0 + L, y0, x0 + L, y0 + B / 2);
    ctx.quadraticCurveTo(x0 + L, y0 + B, x0 + L * (1 - bowTaper), y0 + B);
    ctx.lineTo(x0 + 3, y0 + B);
    ctx.quadraticCurveTo(x0, y0 + B, x0, y0 + B / 2);
    ctx.quadraticCurveTo(x0, y0, x0 + 3, y0);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#dff0fa';
    ctx.lineWidth = 0.14;
    for (let i = 0; i < Math.floor(L / 3); i++) {
      const gx = x0 + 3 + i * 3;
      ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y0 + B); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // deck containers — stacked bottom-up with a small screen lift per tier
    const deck = ship.containers.slice().sort((a, b) => (a.deck.row - b.deck.row) || (a.deck.tier - b.deck.tier));
    for (const c of deck) {
      const spr = SF.containerSprite({ size: c.size, liver: c.liver, condition: c.condition, id: c.id });
      const dw = spr.drawW, dh = spr.drawH;
      const lift = c.deck.tier * 0.9 + c.deck.row * 0.12;
      ctx.globalAlpha = 0.26;
      ctx.drawImage(spr.canvas, c.x - dw / 2 + 0.6, c.y - dh / 2 + 0.8 - lift, dw, dh);
      ctx.globalAlpha = 1;
      ctx.drawImage(spr.canvas, c.x - dw / 2, c.y - dh / 2 - lift, dw, dh);
    }
    // hatch coamings
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#03121c';
    ctx.lineWidth = 0.22;
    for (let b = 0; b < ship.containers.bays; b++) {
      const bx = ship.x - L / 2 + ship.bayLen * b;
      ctx.strokeRect(bx + 0.4, y0 + 1.8, ship.bayLen - 0.8, B - 3.6);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // superstructure at the stern (deliberately compact — real ships carry the
    // accommodation in a short block, leaving the rest of the deck for boxes)
    const sx = x0 + L * 0.10;
    const sw = L * 0.085, sh = B * 0.62;
    ctx.fillStyle = 'rgba(4,14,22,.3)';
    this.roundRect(ctx, sx - sw / 2 + 1.4, ship.y - sh / 2 + 1.6, sw, sh, 1);
    ctx.fill();
    ctx.fillStyle = '#e9f1f6';
    this.roundRect(ctx, sx - sw / 2, ship.y - sh / 2, sw, sh, 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,40,56,.5)';
    ctx.lineWidth = 0.2;
    ctx.stroke();
    // bridge windows + funnel
    ctx.fillStyle = '#20475f';
    ctx.fillRect(sx - sw / 2 + 0.4, ship.y - sh / 2 + 0.6, sw * .5, sh - 1.2);
    ctx.fillStyle = '#33404a';
    this.roundRect(ctx, sx + sw * .1, ship.y - sh * .18, sw * .5, sh * .36, 0.6);
    ctx.fill();
    ctx.fillStyle = '#c0553c';
    this.roundRect(ctx, sx - sw * .3, ship.y - sh * .12, sw * .3, sh * .24, 0.5);
    ctx.fill();
    // mast + navigation lights
    ctx.fillStyle = '#8e9aa5';
    ctx.fillRect(sx - 0.2, ship.y - 0.2, 0.4, 0.4);
    // wake along the bow
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#d8ecf7';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x0 + L * 0.98, y0 + 1);
    ctx.quadraticCurveTo(x0 + L * 1.06, ship.y, x0 + L * 0.98, y0 + B - 1);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // deck edge markings + bollards
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#e8b23a';
    ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + 1.1); ctx.lineTo(x0 + L * 0.92, y0 + 1.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + 2, y0 + B - 1.1); ctx.lineTo(x0 + L * 0.92, y0 + B - 1.1); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#39454f';
    for (const bx of [x0 + L * 0.08, x0 + L * 0.45, x0 + L * 0.9]) {
      for (const by of [y0 + 0.8, y0 + B - 0.8]) {
        ctx.beginPath(); ctx.arc(bx, by, 0.45, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- buildings */
  drawBuildings(ctx, view) {
    for (const b of this.terminal.layout.buildings) {
      const r = b.rect;
      if (r.x + r.w < view.x - 10 || r.x > view.x + view.w + 10) continue;
      if (r.y + r.h < view.y - 10 || r.y > view.y + view.h + 10) continue;
      this.drawBuilding(ctx, b, r);
    }
  }

  drawBuilding(ctx, b, r) {
    ctx.save();
    // cast shadow
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#040f18';
    this.roundRect(ctx, r.x + SHADOW_DX * 0.55, r.y + SHADOW_DY * 0.6, r.w, r.h, 1.2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // roof
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w * 0.3, r.y + r.h);
    if (b.kind === 'warehouse') { g.addColorStop(0, '#7f8c98'); g.addColorStop(1, '#616d78'); }
    else if (b.kind === 'office') { g.addColorStop(0, '#9aa6b1'); g.addColorStop(1, '#7b8792'); }
    else if (b.kind === 'workshop') { g.addColorStop(0, '#6f7b86'); g.addColorStop(1, '#545f69'); }
    else { g.addColorStop(0, '#8b97a2'); g.addColorStop(1, '#6d7984'); }
    ctx.fillStyle = g;
    this.roundRect(ctx, r.x, r.y, r.w, r.h, 1.2);
    ctx.fill();

    // roof ribs / panels
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#0b1a24';
    ctx.lineWidth = 0.14;
    const step = b.kind === 'warehouse' ? 3.4 : 2.6;
    for (let y = r.y + step; y < r.y + r.h; y += step) {
      ctx.beginPath(); ctx.moveTo(r.x + 0.4, y); ctx.lineTo(r.x + r.w - 0.4, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // roof equipment: skylights, vents, HVAC
    if (b.kind === 'warehouse') {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#cfe0ea';
      for (let i = 0; i < 6; i++) {
        const sx = r.x + 6 + (i % 3) * (r.w / 3.4);
        const sy = r.y + 6 + Math.floor(i / 3) * (r.h / 2.2);
        this.roundRect(ctx, sx, sy, r.w * 0.16, r.h * 0.2, 0.6);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#4e5a65';
      this.roundRect(ctx, r.x + r.w * 0.72, r.y + r.h * 0.2, 3.2, 3.2, 0.6);
      ctx.fill();
      this.roundRect(ctx, r.x + r.w * 0.72, r.y + r.h * 0.62, 3.2, 3.2, 0.6);
      ctx.fill();
    }
    if (b.kind === 'office') {
      ctx.fillStyle = '#5c6873';
      this.roundRect(ctx, r.x + 4, r.y + 3, 5, 4, 0.6);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#dfe9f0';
      this.roundRect(ctx, r.x + r.w - 12, r.y + 3, 8, 5, 0.6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // dock doors on the warehouse (with ledges)
    for (const d of b.doors || []) {
      ctx.fillStyle = '#3f4b55';
      if (d.face === 'w' || d.face === 'e') ctx.fillRect(d.x - 0.4, d.y, 0.8 + d.w * 0.2, d.h);
      else ctx.fillRect(d.x, d.y - 0.4, d.w, 0.8 + d.h * 0.2);
      ctx.fillStyle = 'rgba(255,197,61,.7)';
      if (d.face === 'w') ctx.fillRect(d.x - 0.4, d.y, 0.5, d.h);
      else if (d.face === 's') ctx.fillRect(d.x, d.y + d.h - 0.1, d.w, 0.5);
    }

    // outline + roof edge highlight
    ctx.strokeStyle = 'rgba(10,22,32,.5)';
    ctx.lineWidth = 0.28;
    this.roundRect(ctx, r.x, r.y, r.w, r.h, 1.2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 0.18;
    this.roundRect(ctx, r.x + 0.3, r.y + 0.3, r.w - 0.6, r.h - 0.6, 1);
    ctx.stroke();

    // signage
    ctx.save();
    ctx.fillStyle = 'rgba(233,241,246,.75)';
    ctx.font = `700 ${clamp(r.h * 0.16, 1.4, 2.6)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.name.toUpperCase(), r.x + 1.6, r.y + r.h * 0.32);
    ctx.restore();
    ctx.restore();
  }

  /* -------------------------------------------------------- yard zone hints */
  drawYardZones(ctx, view) {
    const T = this.terminal;
    // restricted zones (only when relevant, faded)
    ctx.save();
    ctx.lineWidth = 0.2;
    for (const z of this.terminal.layout.restrictedZones || []) {
      if (!this.showZones) continue;
      const r = z.rect;
      if (r.x + r.w < view.x || r.x > view.x + view.w) continue;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = z.level === 'noEngine' ? '#e5484d' : '#f59e0b';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = z.level === 'noEngine' ? rgba('#e5484d', .7) : rgba('#f59e0b', .7);
      ctx.setLineDash([1.6, 1.2]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }
    // highlighted mission zone
    if (this.zoneHighlight) {
      const z = this.zoneHighlight;
      const pulse = 0.35 + 0.25 * Math.sin(this.wavePhase * 2.4);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = rgba('#22c8b8', .18);
      ctx.fillRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = rgba('#5fe0d2', .9);
      ctx.lineWidth = 0.42;
      ctx.setLineDash([2.4, 1.6]);
      ctx.lineDashOffset = -this.wavePhase * 4;
      ctx.strokeRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- container stacks */
  drawStacks(ctx, view) {
    const T = this.terminal;
    for (const blk of T.layout.yardBlocks) {
      if (blk.rect.x + blk.rect.w < view.x - 6 || blk.rect.x > view.x + view.w + 6) continue;
      if (blk.rect.y + blk.rect.h < view.y - 6 || blk.rect.y > view.y + view.h + 6) continue;
      for (let bay = 0; bay < blk.cols; bay++) {
        for (let row = 0; row < blk.rows; row++) {
          const col = T.slotAt(blk.id, bay, row, 0);
          if (!col) continue;
          const top = T.topTier(blk.id, bay, row);
          if (top < 0) continue;
          const slot = T.slotAt(blk.id, bay, row, top);
          const c = slot.container;
          if (!c) continue;
          this.drawContainer(ctx, c, slot.x, slot.y, 0, top, true);
        }
      }
    }
  }

  /**
   * Draw a container (optionally as part of a stack).
   * `tier` lifts the sprite on screen so stacks read as vertical piles.
   */
  drawContainer(ctx, c, x, y, angle, tier = 0, fromStack = false) {
    const spr = SF.containerSprite({ size: c.size, liver: c.liver, condition: c.condition, id: c.id });
    const lift = tier * 1.5;                    // screen-space lift in metres-ish
    const w = c.length, h = c.width;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (lift > 0) {
      // side wall of the stack below
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#1a2530';
      ctx.fillRect(-w / 2 + 0.3, h / 2 - 0.2, w, lift * 0.55);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.3;
    ctx.drawImage(spr.canvas, -spr.drawW / 2 + SHADOW_DX * .5, -spr.drawH / 2 + SHADOW_DY * .5 - lift, spr.drawW, spr.drawH);
    ctx.globalAlpha = 1;
    ctx.drawImage(spr.canvas, -spr.drawW / 2, -spr.drawH / 2 - lift, spr.drawW, spr.drawH);
    // tier badge
    if (tier > 0 && this.camera.zoom > 0.85) {
      ctx.save();
      ctx.translate(0, -lift);
      ctx.fillStyle = 'rgba(7,23,38,.72)';
      this.roundRect(ctx, w / 2 - 4.6, -h / 2 + 0.4, 4.2, 2.2, 0.5);
      ctx.fill();
      ctx.fillStyle = '#ffc53d';
      ctx.font = '700 1.7px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${tier + 1}`, w / 2 - 2.5, -h / 2 + 1.5);
      ctx.restore();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- dynamic pass */
  drawDynamic(ctx, view, state) {
    const T = this.terminal;
    const list = [];
    const push = (y, fn, x) => list.push({ y, fn, x });

    // ground cargo
    for (const c of T.containers) {
      if (c.status === 'inSlot' || c.hold || c.vessel) continue;
      if (c.x < view.x - 16 || c.x > view.x + view.w + 16) continue;
      if (c.y < view.y - 16 || c.y > view.y + view.h + 16) continue;
      push(c.y, () => this.drawContainer(ctx, c, c.x, c.y, c.angle, 0, false), c.x);
    }
    for (const p of T.pallets) {
      if (p.hold || p.status === 'held') continue;
      if (p.x < view.x - 6 || p.x > view.x + view.w + 6) continue;
      push(p.y, () => this.drawPallet(ctx, p), p.x);
    }

    // trucks in the gate lanes
    for (const t of T.trucks) {
      if (t.x < view.x - 30 || t.x > view.x + view.w + 10) continue;
      push(t.y, () => this.drawTruck(ctx, t.x, t.y, t.angle, t.trailer, t.load, t.id), t.x);
    }

    // yard trailers (with whatever container is on the deck)
    for (const t of T.trailers || []) {
      if (t.x < view.x - 20 || t.x > view.x + view.w + 20) continue;
      if (t.y < view.y - 20 || t.y > view.y + view.h + 20) continue;
      push(t.y - 0.5, () => this.drawTrailer(ctx, t), t.x);
    }

    // ambient traffic
    for (const tr of T.traffic) {
      const x = tr.drawX ?? tr.x, y = tr.drawY ?? tr.y;
      if (x < view.x - 30 || x > view.x + view.w + 30) continue;
      push(y, () => this.drawTruck(ctx, x, y, tr.angle, true, null, tr.id, tr.color), x);
    }

    // pedestrians
    for (const p of T.pedestrians) {
      if (p.x < view.x - 6 || p.x > view.x + view.w + 6) continue;
      push(p.y, () => this.drawPedestrian(ctx, p), p.x);
    }

    // machines (+ their loads)
    for (const v of state.vehicles) {
      const r = Math.max(v.spec.length, v.spec.width) * 0.7 + 4;
      if (v.x + r < view.x || v.x - r > view.x + view.w) continue;
      if (v.y + r < view.y || v.y - r > view.y + view.h) continue;
      push(v.y, () => this.drawVehicle(ctx, v, state.player === v), v.x);
    }

    list.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const item of list) item.fn();
  }

  drawPallet(ctx, p) {
    const spr = p.variant != null ? SF.palletSprite(p.variant) : SF.crateSprite(0);
    const w = p.length, h = p.width;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#16202a';
    this.roundRect(ctx, -w / 2 + SHADOW_DX * .4, -h / 2 + SHADOW_DY * .4, w, h, 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(spr.canvas, -spr.drawW / 2, -spr.drawH / 2, spr.drawW, spr.drawH);
    ctx.restore();
  }

  /** Flat trailer deck with a rear bogie — shared by trucks and yard trailers. */
  drawTrailerBody(ctx, tl, tw, offsetX = -tl * 0.62) {
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#16202a';
    this.roundRect(ctx, offsetX + 1.2, -tw / 2 + 1.4, tl, tw, 0.4); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#59646f';
    this.roundRect(ctx, offsetX, -tw / 2, tl, tw, 0.4); ctx.fill();
    ctx.fillStyle = 'rgba(20,32,42,.35)';
    ctx.fillRect(offsetX, -tw / 2, tl, tw * 0.16);
    // container corner posts so an empty deck still reads as a trailer
    ctx.fillStyle = 'rgba(255,197,61,.5)';
    for (const cx of [offsetX + 0.6, offsetX + tl - 0.6]) {
      for (const cy of [-tw / 2 + 0.35, tw / 2 - 0.35]) ctx.fillRect(cx - 0.18, cy - 0.18, 0.36, 0.36);
    }
    ctx.fillStyle = '#39454f';
    for (const wx of [offsetX + tl * 0.18, offsetX + tl * 0.32, offsetX + tl * 0.55, offsetX + tl * 0.68]) {
      for (const wy of [-tw / 2 - 0.1, tw / 2 + 0.1]) {
        ctx.beginPath(); ctx.arc(wx, wy, 0.45, 0, TAU); ctx.fill();
      }
    }
  }

  drawTrailer(ctx, t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);
    this.drawTrailerBody(ctx, t.length, t.width, -t.length / 2);
    ctx.restore();
  }

  drawTruck(ctx, x, y, angle, withTrailer, load, id, color = '#3f7fb7') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // trailer
    if (withTrailer) {
      this.drawTrailerBody(ctx, 12.2, 2.5);
    }
    // tractor unit
    const cabSprite = SF.machineSprite('tractor');
    ctx.globalAlpha = 0.32;
    ctx.drawImage(cabSprite.shadow, -cabSprite.drawW / 2 + SHADOW_DX * .4, -cabSprite.drawH / 2 + SHADOW_DY * .4, cabSprite.drawW, cabSprite.drawH);
    ctx.globalAlpha = 1;
    ctx.drawImage(cabSprite.canvas, -cabSprite.drawW / 2, -cabSprite.drawH / 2, cabSprite.drawW, cabSprite.drawH);
    ctx.restore();
  }

  drawPedestrian(ctx, p) {
    const s = 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#0a1620';
    ctx.beginPath(); ctx.ellipse(0.5, 0.6, 0.62, 0.5, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.rotate(p.angle);
    // hi-vis vest torso
    ctx.fillStyle = '#ffd23d';
    this.roundRect(ctx, -0.34, -0.3, 0.68, 0.6, 0.22); ctx.fill();
    ctx.fillStyle = '#e8eef3';
    ctx.fillRect(-0.1, -0.3, 0.16, 0.6);
    // head + hard hat
    ctx.fillStyle = '#d79a72';
    ctx.beginPath(); ctx.arc(0.16, 0, 0.23, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6c62f';
    ctx.beginPath(); ctx.arc(0.14, 0, 0.26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------- machines --- */
  drawVehicle(ctx, v, isPlayer) {
    const sp = SF.machineSprite(v.type);
    const dims = { L: sp.l * sp.ppu, W: sp.w * sp.ppu };
    const angle = v.angle;

    // ground shadow (fixed sun direction)
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(sp.shadow,
      -sp.drawW / 2 + SHADOW_DX, -sp.drawH / 2 + SHADOW_DY,
      sp.drawW, sp.drawH);
    ctx.globalAlpha = 1;
    ctx.restore();

    // chassis
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(angle);
    ctx.drawImage(sp.canvas, -sp.drawW / 2, -sp.drawH / 2, sp.drawW, sp.drawH);
    // articulated parts are authored in sprite-pixel space: translate to the
    // sprite origin then scale down to metres.
    ctx.save();
    ctx.translate(-sp.drawW / 2 + sp.pad, -sp.drawH / 2 + sp.pad);
    ctx.scale(1 / sp.ppu, 1 / sp.ppu);
    SF.drawAttachment(ctx, v.type, { ...v.drawState(), load: !!v.load }, sp.ppu, dims);
    ctx.restore();

    // carried load
    if (v.load) {
      const c = v.load;
      const local = this.loadLocalOffset(v);
      ctx.save();
      ctx.translate(local.x, local.y);
      const spr = c.kind === 'container'
        ? SF.containerSprite({ size: c.size, liver: c.liver, condition: c.condition, id: c.id })
        : (c.variant != null ? SF.palletSprite(c.variant) : SF.crateSprite(0));
      ctx.rotate(local.rot);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#0a1620';
      ctx.fillRect(-c.length / 2 + SHADOW_DX * .4, -c.width / 2 + SHADOW_DY * .4, c.length, c.width);
      ctx.globalAlpha = 1;
      ctx.drawImage(spr.canvas, -spr.drawW / 2, -spr.drawH / 2, spr.drawW, spr.drawH);
      ctx.restore();
    }
    ctx.restore();

    // selection ring for the player machine
    if (isPlayer) {
      const r = Math.max(sp.w, sp.l) * 0.62;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = rgba('#5fe0d2', .55);
      ctx.lineWidth = 0.16;
      ctx.setLineDash([1.4, 1.2]);
      ctx.beginPath();
      ctx.ellipse(v.x, v.y, r * 1.15, r * 0.82, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // beacons
    const beacons = BEACONS[v.type] || [];
    const pulse = 0.35 + 0.45 * Math.max(0, Math.sin(this.wavePhase * 4 + (v.reversing ? 1.5 : 0)));
    for (const b of beacons) {
      const p = v.localToWorld(b[0] * sp.l / 5.3, b[1] * sp.w / 2.7);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.42, 0, TAU); ctx.fill();
      ctx.globalAlpha = pulse * 0.34;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.15, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // reversing lamp / brake lamps
    if (isPlayer || Math.abs(v.speed) > 0.2) {
      const back = v.localToWorld(-sp.l * 0.48, 0);
      const lampColor = v.speed < -0.2 ? '#f2f7fb' : (v.brakeOn ? '#e5484d' : null);
      if (lampColor) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = lampColor;
        ctx.beginPath(); ctx.arc(back.x, back.y, 0.34, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(back.x, back.y, 1.0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    // name plate when zoomed in enough
    if (this.camera.zoom > 1.0 && isPlayer) {
      ctx.save();
      ctx.font = '600 0.9px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(7,23,38,.7)';
      const label = `${v.spec.short}`;
      const w = ctx.measureText(label).width + 1.2;
      this.roundRect(ctx, v.x - w / 2, v.y - sp.w / 2 - 3.2, w, 1.6, 0.5);
      ctx.fill();
      ctx.fillStyle = '#dfe9f0';
      ctx.fillText(label, v.x, v.y - sp.w / 2 - 2.15);
      ctx.restore();
    }
  }

  /**
   * Where a carried load sits, in the chassis local frame (METRES).
   * Must stay in sync with the attachment geometry in SpriteFactory.
   */
  loadLocalOffset(v) {
    const L = v.spec.length;
    if (v.type === 'forklift') {
      return { x: L * 0.62 + L * 0.30 * 0.55, y: v.sideShift, rot: 0 };
    }
    if (v.type === 'reachstacker') {
      const st = v.drawState();
      const pivot = L * (v.spec.boomPivotX ?? 0.56);
      const len = L * 0.42 + L * 0.58 * st.boomExtend;
      return { x: pivot + Math.cos(st.boomAngle) * len, y: Math.sin(st.boomAngle) * len, rot: st.boomAngle };
    }
    if (v.type === 'rtg') {
      return { x: 0, y: v.spreaderOffsetY ? v.spreaderOffsetY() : 0, rot: 0 };
    }
    if (v.type === 'harborcrane') {
      return { x: L * 0.46 + (v.radius ?? 10), y: 0, rot: 0 };
    }
    return { x: L * 0.45, y: 0, rot: 0 };
  }

  /* ------------------------------------------------------------------ overlays */
  drawOverlays(ctx, view, state) {
    const cam = this.camera;
    // placement ghost for the carried load
    if (state.ghost) {
      const g = state.ghost;
      ctx.save();
      ctx.globalAlpha = g.valid ? 0.5 : 0.42;
      ctx.fillStyle = g.valid ? rgba('#22c8b8', .35) : rgba('#e5484d', .35);
      ctx.strokeStyle = g.valid ? rgba('#5fe0d2', .9) : rgba('#ff8a8f', .9);
      ctx.lineWidth = 0.3;
      ctx.setLineDash([1.4, 1.0]);
      ctx.fillRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h);
      ctx.strokeRect(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // lift target helper: dashed targeting box on the candidate cargo
    if (state.liftTarget) {
      const c = state.liftTarget;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = rgba('#ffc53d', .85);
      ctx.lineWidth = 0.26;
      ctx.setLineDash([1.2, 0.9]);
      const pad = c.kind === 'container' ? 0.6 : 0.5;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.strokeRect(-c.length / 2 - pad, -c.width / 2 - pad, c.length + pad * 2, c.width + pad * 2);
      ctx.restore();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // mission markers
    for (const m of state.markers || []) {
      this.drawMarker(ctx, m);
    }

    // pedestrian safety halo when very close to the player machine
    if (state.pedNear) {
      const p = state.pedNear;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = rgba('#e5484d', .8);
      ctx.lineWidth = 0.24;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = rgba('#e5484d', .4);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawMarker(ctx, m) {
    const t = this.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const color = m.color || '#22c8b8';
    ctx.save();
    ctx.translate(m.x, m.y);
    // ground ring
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    ctx.strokeStyle = rgba(color, .9);
    ctx.lineWidth = 0.34;
    ctx.beginPath(); ctx.arc(0, 0, m.radius ?? 3.2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.14 + pulse * 0.1;
    ctx.fillStyle = rgba(color, .5);
    ctx.beginPath(); ctx.arc(0, 0, (m.radius ?? 3.2) * (0.75 + pulse * 0.18), 0, TAU); ctx.fill();
    // vertical pin (always drawn screen-up so it reads at any zoom)
    ctx.globalAlpha = 1;
    const lift = (m.radius ?? 3.2) * 1.1;
    ctx.beginPath();
    ctx.moveTo(0, -lift);
    ctx.lineTo(-0.9, -lift - 1.8);
    ctx.lineTo(0.9, -lift - 1.8);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath(); ctx.arc(0, -lift - 2.6, 1.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(7,23,38,.85)';
    ctx.beginPath(); ctx.arc(0, -lift - 2.6, 0.62, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ helper */
  roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

/** Beacon positions per machine type, in units of (length/5.3, width/2.7). */
const BEACONS = {
  forklift: [[-1.6, -1.0]],
  reachstacker: [[-4.0, -0.9], [-4.0, 0.9]],
  rtg: [[2.2, 3.4], [-2.2, 3.4]],
  harborcrane: [[-1.4, -1.6], [-1.4, 1.6]],
  tractor: [[0.9, -0.9]],
  straddle: [[0.2, -1.5], [0.2, 1.5]]
};

export default Renderer;
