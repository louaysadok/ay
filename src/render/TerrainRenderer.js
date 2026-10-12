/**
 * TerrainRenderer.js — bakes the terminal ground into offscreen canvases.
 *
 * Everything static (surfaces, lane markings, decals, kerbs, quay furniture)
 * is drawn once at load time into a large canvas plus a small minimap canvas.
 * Per frame the renderer then only blits two images, which keeps the ground
 * essentially free even on low-end hardware.
 */
import { makeRng, rgba, shade, TAU, clamp } from '../engine/Utils.js';

export const GROUND_PPU = 9.4;      // pixels per metre for the baked ground
                                    // matched to the default camera zoom so the
                                    // terminal renders 1:1 instead of upscaled
export const MINIMAP_PPU = 1.35;

export class TerrainRenderer {
  constructor(layout) {
    this.layout = layout;
    this.w = layout.world.w;
    this.h = layout.world.h;
    this.ppu = GROUND_PPU;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(this.w * this.ppu);
    this.canvas.height = Math.ceil(this.h * this.ppu);
    this.ctx = this.canvas.getContext('2d');
    this.rng = makeRng(90210);
    this.bake();

    this.mini = document.createElement('canvas');
    this.mini.width = Math.ceil(this.w * MINIMAP_PPU);
    this.mini.height = Math.ceil(this.h * MINIMAP_PPU);
    this.miniCtx = this.mini.getContext('2d');
    this.bakeMinimap();
  }

  /* ------------------------------------------------------------- helpers -- */
  m(v) { return v * this.ppu; }                    // metres → pixels

  rect(r, fill) {
    const c = this.ctx;
    c.fillStyle = fill;
    c.fillRect(this.m(r.x), this.m(r.y), this.m(r.w), this.m(r.h));
  }

  /** Speckle. Default is fine grain (asphalt/concrete); pass scale 0.4 for big stains. */
  noise(r, color, count, sizeRange = [1, 5], alpha = 0.12, scale = 0.16) {
    const c = this.ctx;
    const rng = this.rng;
    c.save();
    c.globalAlpha = alpha * (scale < 0.3 ? 1.5 : 1);
    c.fillStyle = color;
    const n = Math.round(count * (scale < 0.3 ? 3 : 1));
    for (let i = 0; i < n; i++) {
      const x = this.m(r.x + rng.range(0, r.w));
      const y = this.m(r.y + rng.range(0, r.h));
      const hi = scale < 0.3 ? Math.min(sizeRange[1], 3.2) : sizeRange[1];
      const s = this.m(rng.range(Math.min(sizeRange[0], hi), hi)) * scale;
      c.beginPath();
      c.ellipse(x, y, s, s * rng.range(0.5, 1), rng.range(0, TAU), 0, TAU);
      c.fill();
    }
    c.restore();
  }

  line(x1, y1, x2, y2, color, width = 0.25, dash = null) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = color;
    c.lineWidth = this.m(width);
    if (dash) c.setLineDash(dash.map((d) => this.m(d)));
    c.beginPath();
    c.moveTo(this.m(x1), this.m(y1));
    c.lineTo(this.m(x2), this.m(y2));
    c.stroke();
    c.restore();
  }

  /* ---------------------------------------------------------------- bake -- */
  bake() {
    const c = this.ctx;
    const P = this.layout.palette;
    const L = this.layout;

    // ---------- base -------------------------------------------------------
    c.fillStyle = P.concreteDark;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // subtle depth wash: slightly lighter near the quay, darker to the south
    const g = c.createLinearGradient(0, this.m(L.world.waterLine), 0, this.canvas.height);
    g.addColorStop(0, 'rgba(255,255,255,.035)');
    g.addColorStop(1, 'rgba(0,0,0,.14)');
    c.fillStyle = g;
    c.fillRect(0, this.m(L.world.waterLine), this.canvas.width, this.canvas.height - this.m(L.world.waterLine));

    // ---------- water (static part; waves animate on top) ------------------
    const wr = L.water.rect;
    const wg = c.createLinearGradient(0, 0, 0, this.m(wr.h));
    wg.addColorStop(0, '#0d3f5e');
    wg.addColorStop(.55, P.water);
    wg.addColorStop(1, P.waterDeep);
    c.fillStyle = wg;
    c.fillRect(0, 0, this.canvas.width, this.m(wr.h));
    // quay wall shading under the edge
    const wall = c.createLinearGradient(0, this.m(wr.h - 2), 0, this.m(wr.h + 1.6));
    wall.addColorStop(0, 'rgba(4,18,28,.0)');
    wall.addColorStop(.7, 'rgba(4,18,28,.45)');
    wall.addColorStop(1, 'rgba(4,18,28,0)');
    c.fillStyle = wall;
    c.fillRect(0, this.m(wr.h - 2), this.canvas.width, this.m(3.6));
    // quay coping stone edge
    c.fillStyle = '#5d6a74';
    c.fillRect(0, this.m(wr.h), this.canvas.width, this.m(0.8));
    c.fillStyle = 'rgba(255,255,255,.16)';
    c.fillRect(0, this.m(wr.h), this.canvas.width, this.m(0.24));

    // ---------- area surfaces ---------------------------------------------
    for (const a of L.areas) {
      const col = P[a.surface] || P.concrete;
      this.rect(a.rect, col);
    }

    // quay apron: slightly brighter surface + heavy tyre polish
    this.rect(L.areas[0].rect, rgba('#ffffff', .035));

    // ---------- surface textures ------------------------------------------
    for (const a of L.areas) {
      const r = a.rect;
      this.noise(r, '#0b141b', 150, [2, 11], .05);
      this.noise(r, '#e9f1f7', 60, [1.5, 7], .028);
    }
    // concrete expansion joints across the whole apron + yard
    c.save();
    c.strokeStyle = 'rgba(16,26,34,.26)';
    c.lineWidth = this.m(0.16);
    for (let x = 0; x < this.w; x += 12) {
      c.beginPath(); c.moveTo(this.m(x), this.m(L.world.waterLine)); c.lineTo(this.m(x), this.m(this.h)); c.stroke();
    }
    for (let y = L.world.waterLine; y < this.h; y += 12) {
      c.beginPath(); c.moveTo(0, this.m(y)); c.lineTo(this.canvas.width, this.m(y)); c.stroke();
    }
    c.restore();

    // ---------- roads -------------------------------------------------------
    for (const road of L.roads) {
      if (road.w <= 0) continue;
      const r = road.rect;
      c.fillStyle = road.main ? P.asphalt : P.asphaltDark;
      c.fillRect(this.m(r.x), this.m(r.y), this.m(r.w), this.m(r.h));
      // subtle asphalt variation
      this.noise(r, '#0b1319', 150, [2, 12], .07);
      this.noise(r, '#c9d4dc', 50, [1, 5], .028);
    }
    // lane markings: centre dashes + edge lines
    for (const road of L.roads) {
      if (road.w < 8) continue;
      const r = road.rect;
      const horizontal = r.w >= r.h;
      const mid = horizontal ? r.y + r.h / 2 : r.x + r.w / 2;
      if (horizontal) {
        this.line(r.x + 1, mid, r.x + r.w - 1, mid, rgba('#f2f6f9', .62), .18, [3, 3.4]);
        this.line(r.x + 1, r.y + .9, r.x + r.w - 1, r.y + .9, rgba('#f2f6f9', .3), .16);
        this.line(r.x + 1, r.y + r.h - .9, r.x + r.w - 1, r.y + r.h - .9, rgba('#f2f6f9', .3), .16);
      } else {
        this.line(mid, r.y + 1, mid, r.y + r.h - 1, rgba('#f2f6f9', .62), .18, [3, 3.4]);
        this.line(r.x + .9, r.y + 1, r.x + .9, r.y + r.h - 1, rgba('#f2f6f9', .3), .16);
        this.line(r.x + r.w - .9, r.y + 1, r.x + r.w - .9, r.y + r.h - 1, rgba('#f2f6f9', .3), .16);
      }
    }
    // kerbs: thin light strip on the south/outside edge of main roads
    c.save();
    c.fillStyle = 'rgba(230,238,243,.28)';
    for (const road of L.roads) {
      if (road.w < 8) continue;
      const r = road.rect;
      c.fillRect(this.m(r.x), this.m(r.y + r.h), this.m(r.w), this.m(0.35));
    }
    c.restore();

    // junction give-way triangles at the two main crossings
    this.giveWay(20, 66, 0);
    this.giveWay(259, 80, Math.PI / 2);
    this.giveWay(20, 190, 0);
    this.giveWay(259, 170, -Math.PI / 2);

    // ---------- yard pavement & block layout -------------------------------
    const yard = L.areas.find((a) => a.id === 'yard');
    if (yard) {
      this.rect(yard.rect, rgba('#ffffff', .015));
      // gantry travel lanes (yellow-ish dashed guides)
      for (const blk of L.yardBlocks) {
        const r = blk.rect;
        // lane lines either side of the block row
        this.line(r.x, blk.y - 3.2, r.x + r.w, blk.y - 3.2, rgba('#e8b23a', .30), .16, [2.6, 2.6]);
        this.line(r.x, blk.y + blk.rows * 2.7 + 3.2, r.x + r.w, blk.y + blk.rows * 2.7 + 3.2, rgba('#e8b23a', .30), .16, [2.6, 2.6]);
        // bay separators + the block perimeter; worn, not drawn with a ruler
        const top = blk.y, bot = blk.y + blk.rows * 2.7;
        for (let bay = 0; bay <= blk.cols; bay++) {
          const x = blk.x + bay * (blk.slotW + blk.gap);
          this.line(x, top, x, bot, rgba('#0b1a24', .2), .16);
        }
        this.line(blk.x, top, blk.x + blk.cols * (blk.slotW + blk.gap) - blk.gap, top, rgba('#eef5fa', .1), .14);
        this.line(blk.x, bot, blk.x + blk.cols * (blk.slotW + blk.gap) - blk.gap, bot, rgba('#eef5fa', .1), .14);
        // bay numbers along the top edge of the block, terminal-style
        for (let bay = 0; bay < blk.cols; bay++) {
          const x = blk.x + bay * (blk.slotW + blk.gap) + blk.slotW / 2;
          this.ctx.save();
          this.ctx.fillStyle = rgba('#eef5fa', .34);
          this.ctx.font = `700 ${this.m(1.7)}px "Segoe UI", system-ui, sans-serif`;
          this.ctx.textAlign = 'center';
          this.ctx.fillText(String(bay + 1), this.m(x), this.m(blk.y - 1.5));
          this.ctx.restore();
        }
        // one block name per block, on the west end of the lane above it
        this.ctx.save();
        this.ctx.fillStyle = rgba('#eef5fa', .2);
        this.ctx.font = `800 ${this.m(1.9)}px "Segoe UI", system-ui, sans-serif`;
        this.ctx.textAlign = 'left';
        this.ctx.fillText(blk.name.toUpperCase(), this.m(blk.x), this.m(blk.y - 5.2));
        this.ctx.fillStyle = rgba('#eef5fa', .1);
        this.ctx.fillRect(this.m(blk.x), this.m(blk.y - 4.4), this.m(blk.cols * (blk.slotW + blk.gap) - blk.gap), this.m(.24));
        this.ctx.restore();
        // worn tyre arcs inside the lanes
        this.noise({ x: r.x, y: blk.y - 5, w: r.w, h: 4 }, '#1a2229', 60, [1, 3], .05);
      }
    }

    // ---------- warehouse apron -------------------------------------------
    const wh = L.areas.find((a) => a.id === 'warehouse');
    if (wh) {
      // hatching in front of the dock doors
      c.save();
      c.globalAlpha = .3;
      c.strokeStyle = P.yellowLine;
      c.lineWidth = this.m(.18);
      for (const b of L.buildings.filter((b) => b.kind === 'warehouse')) {
        for (const d of b.doors || []) {
          for (let i = -1; i < 4; i++) {
            c.beginPath();
            c.moveTo(this.m(d.x - 3), this.m(d.y + d.h * 0.1 + i * 2.4));
            c.lineTo(this.m(d.x - 7), this.m(d.y + d.h * 0.1 + i * 2.4 + 3));
            c.stroke();
          }
        }
      }
      c.restore();
      // keep-clear yellow edge
      this.line(wh.rect.x + 4, wh.rect.y + 4, wh.rect.x + 4, wh.rect.y + wh.rect.h - 4, rgba('#e8b23a', .35), .2);
    }

    // ---------- gate lanes --------------------------------------------------
    const gate = L.areas.find((a) => a.id === 'gate');
    if (gate) {
      this.rect(gate.rect, rgba('#ffffff', .02));
      for (const spot of L.truckSpots) {
        const y0 = spot.y - 5.5, y1 = spot.y + 5.5;
        this.line(spot.x - 26, y0, spot.x + 8, y0, rgba('#f2f6f9', .3), .16, [2, 2]);
        this.line(spot.x - 26, y1, spot.x + 8, y1, rgba('#f2f6f9', .3), .16, [2, 2]);
        this.line(spot.x - 4, y0, spot.x - 4, y1, rgba('#e5484d', .45), .34);   // stop line
        // lane number
        c.save();
        c.fillStyle = rgba('#ffffff', .2);
        c.font = `700 ${this.m(2.2)}px "Segoe UI", system-ui, sans-serif`;
        c.textAlign = 'center';
        const nm = spot.id.split('-').pop();
        c.fillText(nm, this.m(spot.x - 20), this.m(spot.y + .9));
        c.restore();
        // tyre wear
        this.noise({ x: spot.x - 26, y: y0, w: 26, h: 11 }, '#141b21', 40, [1, 3], .06);
      }
      // gate house apron hatching
      c.save();
      c.globalAlpha = .22; c.strokeStyle = P.yellowLine; c.lineWidth = this.m(.2);
      for (let i = 0; i < 26; i++) {
        c.beginPath();
        c.moveTo(this.m(300 + i), this.m(150));
        c.lineTo(this.m(304 + i), this.m(146));
        c.stroke();
      }
      c.restore();
    }

    // ---------- maintenance area -------------------------------------------
    const maint = L.areas.find((a) => a.id === 'maintenance');
    if (maint) {
      this.noise(maint.rect, '#101820', 220, [1.5, 8], .1, 0.4);   // oil staining
      // bay outlines
      for (let i = 0; i < 2; i++) {
        const bx = maint.rect.x + 4 + i * 20, by = maint.rect.y + 20;
        c.save();
        c.strokeStyle = rgba('#f2f6f9', .22);
        c.lineWidth = this.m(.24);
        c.strokeRect(this.m(bx), this.m(by), this.m(16), this.m(9));
        c.restore();
      }
      // fuel island pad + hatching
      const fi = L.fuelIsland;
      this.rect(fi, rgba('#ffffff', .05));
      c.save();
      c.globalAlpha = .3; c.strokeStyle = P.yellowLine; c.lineWidth = this.m(.2);
      c.strokeRect(this.m(fi.x), this.m(fi.y), this.m(fi.w), this.m(fi.h));
      c.restore();
    }

    // ---------- training area ----------------------------------------------
    const tr = L.areas.find((a) => a.id === 'training');
    if (tr) {
      // light wash to make the training area read as a dedicated pad
      c.save();
      c.fillStyle = rgba('#ffffff', .025);
      c.fillRect(this.m(tr.rect.x), this.m(tr.rect.y), this.m(tr.rect.w), this.m(tr.rect.h));
      c.restore();
      for (const pad of L.trainingPads) {
        c.save();
        // pad plate
        c.fillStyle = rgba('#22c8b8', .07);
        c.fillRect(this.m(pad.x), this.m(pad.y), this.m(pad.w), this.m(pad.h));
        c.strokeStyle = rgba('#22c8b8', .42);
        c.lineWidth = this.m(.28);
        c.strokeRect(this.m(pad.x), this.m(pad.y), this.m(pad.w), this.m(pad.h));
        // corner ticks
        c.strokeStyle = rgba('#eafcfa', .6);
        c.lineWidth = this.m(.22);
        const tick = 3.4;
        const corners = [[pad.x, pad.y, 1, 1], [pad.x + pad.w, pad.y, -1, 1], [pad.x, pad.y + pad.h, 1, -1], [pad.x + pad.w, pad.y + pad.h, -1, -1]];
        for (const [cx, cy, sx, sy] of corners) {
          c.beginPath();
          c.moveTo(this.m(cx), this.m(cy + sy * tick));
          c.lineTo(this.m(cx), this.m(cy));
          c.lineTo(this.m(cx + sx * tick), this.m(cy));
          c.stroke();
        }
        // number
        c.fillStyle = rgba('#22c8b8', .34);
        c.font = `800 ${this.m(6)}px "Segoe UI", system-ui, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(pad.label, this.m(pad.x + pad.w / 2), this.m(pad.y + pad.h / 2));
        c.restore();
      }
      // fork-il position marks
      for (let i = 0; i < 3; i++) {
        const x = tr.rect.x + 12 + i * 38;
        this.line(x, tr.rect.y + 6, x, tr.rect.y + 12, rgba('#f2f6f9', .3), .22, [1.6, 1.6]);
      }
    }

    // ---------- walkways ----------------------------------------------------
    for (const w of L.walkways || []) {
      c.save();
      c.fillStyle = rgba('#e8eef3', .10);
      c.fillRect(this.m(w.x), this.m(w.y), this.m(w.w), this.m(w.h));
      c.strokeStyle = rgba('#e8eef3', .28);
      c.lineWidth = this.m(.14);
      c.setLineDash([this.m(1.2), this.m(1.2)]);
      c.strokeRect(this.m(w.x), this.m(w.y), this.m(w.w), this.m(w.h));
      c.restore();
      // pedestrian glyphs
      for (let i = 0; i < Math.floor(w.w / 26); i++) {
        const px = w.x + 12 + i * 26, py = w.y + w.h / 2;
        this.pedGlyph(px, py);
      }
    }

    // ---------- quay furniture ---------------------------------------------
    // bollards along the quay edge
    for (let x = 14; x < this.w - 10; x += 24) this.bollard(x, L.world.waterLine - 1.9);
    // crane rails for the ship-to-shore gantry
    this.line(6, L.world.waterLine + 5.4, this.w - 6, L.world.waterLine + 5.4, rgba('#5c6870', .55), .35);
    this.line(6, L.world.waterLine + 21.4, this.w - 6, L.world.waterLine + 21.4, rgba('#5c6870', .55), .35);
    this.line(6, L.world.waterLine + 5.4, this.w - 6, L.world.waterLine + 5.4, rgba('#0d1a22', .3), .12);
    // reefer plug cabinets along the quay
    for (let x = 60; x < 300; x += 60) {
      c.save();
      c.fillStyle = '#4a5560';
      c.fillRect(this.m(x), this.m(L.world.waterLine + 8), this.m(1.6), this.m(1));
      c.fillStyle = rgba('#ffc53d', .5);
      c.fillRect(this.m(x + .2), this.m(L.world.waterLine + 8.2), this.m(1.2), this.m(.2));
      c.restore();
    }
    // safety line along the quay edge (yellow)
    this.line(8, L.world.waterLine + 2.6, this.w - 8, L.world.waterLine + 2.6, rgba('#e8b23a', .35), .22, [3, 2]);

    // ---------- parking -----------------------------------------------------
    const park = L.parking;
    c.save();
    c.strokeStyle = rgba('#f2f6f9', .34);
    c.lineWidth = this.m(.16);
    const pw = park.w / park.cols, ph = park.h / park.rows;
    for (let i = 0; i <= park.cols; i++) {
      c.beginPath();
      c.moveTo(this.m(park.x + i * pw), this.m(park.y));
      c.lineTo(this.m(park.x + i * pw), this.m(park.y + park.h));
      c.stroke();
    }
    for (let j = 0; j <= park.rows; j++) {
      c.beginPath();
      c.moveTo(this.m(park.x), this.m(park.y + j * ph));
      c.lineTo(this.m(park.x + park.w), this.m(park.y + j * ph));
      c.stroke();
    }
    c.restore();

    // ---------- fences ------------------------------------------------------
    for (const f of L.fences) {
      c.save();
      c.fillStyle = '#6b7681';
      c.fillRect(this.m(f.x), this.m(f.y), this.m(f.w), this.m(f.h));
      c.fillStyle = rgba('#0b141b', .35);
      for (let i = 0; i < Math.max(f.w, f.h); i += 4) {
        if (f.w > f.h) c.fillRect(this.m(f.x + i), this.m(f.y), this.m(.5), this.m(f.h));
        else c.fillRect(this.m(f.x), this.m(f.y + i), this.m(f.w), this.m(.5));
      }
      c.restore();
    }

    // ---------- dirt / wear edges near the perimeter ------------------------
    this.noise({ x: 0, y: L.world.waterLine, w: 8, h: this.h - L.world.waterLine }, '#4c4235', 120, [2, 9], .1, 0.3);
    this.noise({ x: this.w - 8, y: L.world.waterLine, w: 8, h: this.h - L.world.waterLine }, '#4c4235', 120, [2, 9], .1, 0.3);
    this.noise({ x: 0, y: this.h - 6, w: this.w, h: 6 }, '#4c4235', 160, [2, 10], .09, 0.3);

    // manholes + drains
    const rng = this.rng;
    for (let i = 0; i < 26; i++) {
      const x = rng.range(12, this.w - 12), y = rng.range(L.world.waterLine + 6, this.h - 8);
      c.save();
      c.globalAlpha = .3;
      c.beginPath(); c.arc(this.m(x), this.m(y), this.m(.6), 0, TAU);
      c.fillStyle = '#2c3439'; c.fill();
      c.strokeStyle = '#6f7a83'; c.lineWidth = this.m(.12); c.stroke();
      c.restore();
    }
    // drainage grates along the quay
    for (let x = 30; x < this.w - 20; x += 48) {
      c.save();
      c.fillStyle = '#333c42';
      c.fillRect(this.m(x), this.m(L.world.waterLine + 3.6), this.m(1.6), this.m(.9));
      c.fillStyle = 'rgba(0,0,0,.45)';
      for (let i = 0; i < 4; i++) c.fillRect(this.m(x + .2 + i * .35), this.m(L.world.waterLine + 3.7), this.m(.14), this.m(.7));
      c.restore();
    }

    // ---------- greenery: grass verges, hedges and trees --------------------
    this._bakeGreenery();

    // ---------- lamp posts with a baked pool of warm light ------------------
    this._bakeLamps();

    // ---------- tyre scrub arcs inside the yard ----------------------------
    c.save();
    c.globalAlpha = .045;
    c.strokeStyle = '#101820';
    c.lineWidth = this.m(.35);
    for (let i = 0; i < 22; i++) {
      const x = rng.range(30, 250), y = rng.range(90, 186);
      const r = rng.range(6, 22);
      const a0 = rng.range(0, TAU);
      c.beginPath();
      c.arc(this.m(x), this.m(y), this.m(r), a0, a0 + rng.range(.6, 1.7));
      c.stroke();
    }
    c.restore();
  }


  /* ---------------------------------------------------- greenery + lamps -- */
  _bakeGreenery() {
    const c = this.ctx, P = this.layout.palette, L = this.layout, rng = this.rng;
    const wl = L.world.waterLine;
    // grass verge strips along the west / east / south perimeter
    const strips = [
      { x: 0, y: wl + 1, w: 6.5, h: this.h - wl - 1 },
      { x: this.w - 6.5, y: wl + 1, w: 6.5, h: this.h - wl - 1 },
      { x: 6.5, y: this.h - 5, w: this.w - 13, h: 5 }
    ];
    for (const s of strips) {
      const g = c.createLinearGradient(this.m(s.x), this.m(s.y), this.m(s.x + (s.w < s.h ? s.w : 0)), this.m(s.y + (s.w < s.h ? 0 : s.h)));
      g.addColorStop(0, rgba(P.grass, .9)); g.addColorStop(1, rgba(P.grass, .55));
      c.fillStyle = g;
      c.fillRect(this.m(s.x), this.m(s.y), this.m(s.w), this.m(s.h));
      this.noise(s, '#2f4d2c', 160, [1, 3], .12);
      this.noise(s, '#86b36e', 120, [1, 3], .1);
    }
    // kerb line where the verge meets the paving
    c.fillStyle = 'rgba(210,220,228,.5)';
    c.fillRect(this.m(6.5), this.m(wl + 1), this.m(.35), this.m(this.h - wl - 6));
    c.fillRect(this.m(this.w - 6.85), this.m(wl + 1), this.m(.35), this.m(this.h - wl - 6));
    const tree = (x, y, r) => {
      // soft shadow to the south-east, then layered canopy
      c.save();
      c.globalAlpha = .28; c.fillStyle = '#04100a';
      c.beginPath(); c.ellipse(this.m(x + r * .45), this.m(y + r * .55), this.m(r * 1.05), this.m(r * .9), 0, 0, TAU); c.fill();
      c.globalAlpha = 1;
      const cols = ['#27573a', '#2f6b45', '#3b8052', '#4d9a62'];
      for (let i = 0; i < cols.length; i++) {
        const k = 1 - i * .2;
        c.fillStyle = cols[i];
        c.beginPath();
        c.arc(this.m(x - i * r * .06), this.m(y - i * r * .07), this.m(r * k), 0, TAU);
        c.fill();
      }
      c.fillStyle = 'rgba(210,245,200,.22)';
      for (let i = 0; i < 7; i++) {
        const a = rng.range(0, TAU), d = rng.range(0, r * .55);
        c.beginPath(); c.arc(this.m(x - r * .2 + Math.cos(a) * d), this.m(y - r * .25 + Math.sin(a) * d), this.m(r * rng.range(.1, .2)), 0, TAU); c.fill();
      }
      c.restore();
    };
    for (let y = wl + 12; y < this.h - 10; y += rng.range(13, 19)) {
      tree(rng.range(1.9, 3.6), y, rng.range(1.5, 2.3));
      tree(this.w - rng.range(1.9, 3.6), y + rng.range(-3, 3), rng.range(1.5, 2.3));
    }
    for (let x = 14; x < this.w - 14; x += rng.range(15, 22)) tree(x, this.h - rng.range(1.8, 3), rng.range(1.3, 2));
    // low hedges beside the office buildings
    const hedge = (x, y, w, h) => {
      c.fillStyle = '#2d6040'; c.fillRect(this.m(x), this.m(y), this.m(w), this.m(h));
      c.fillStyle = 'rgba(160,220,150,.22)'; c.fillRect(this.m(x), this.m(y), this.m(w), this.m(Math.min(h, .5)));
    };
    for (const b of L.buildings) {
      if (b.kind !== 'office') continue;
      hedge(b.rect.x, b.rect.y + b.rect.h + 1.4, b.rect.w, 1);
    }
  }

  _bakeLamps() {
    const c = this.ctx, L = this.layout;
    for (const [x, y] of L.lampPosts || []) {
      // light pool (additive, very low alpha: reads as a soft warm patch on the paving)
      c.save();
      c.globalCompositeOperation = 'lighter';
      const R = this.m(15);
      const g = c.createRadialGradient(this.m(x), this.m(y), 0, this.m(x), this.m(y), R);
      g.addColorStop(0, 'rgba(255,214,140,.16)'); g.addColorStop(.5, 'rgba(255,214,140,.06)'); g.addColorStop(1, 'rgba(255,214,140,0)');
      c.fillStyle = g; c.beginPath(); c.arc(this.m(x), this.m(y), R, 0, TAU); c.fill();
      c.restore();
      // pole base, shadow and lamp head
      c.save();
      c.globalAlpha = .3; c.fillStyle = '#05121c';
      c.beginPath(); c.ellipse(this.m(x + 1.4), this.m(y + 1.7), this.m(.9), this.m(.45), .6, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = '#2b333b'; c.beginPath(); c.arc(this.m(x), this.m(y), this.m(.55), 0, TAU); c.fill();
      c.fillStyle = '#6d7a86'; c.beginPath(); c.arc(this.m(x), this.m(y), this.m(.3), 0, TAU); c.fill();
      c.fillStyle = '#ffe3a6'; c.beginPath(); c.arc(this.m(x - .2), this.m(y - .25), this.m(.22), 0, TAU); c.fill();
      c.restore();
    }
  }

  /* --------------------------------------------------------- decor pieces -- */
  giveWay(x, y, rot) {
    const c = this.ctx;
    c.save();
    c.translate(this.m(x), this.m(y));
    c.rotate(rot);
    c.globalAlpha = .35;
    c.fillStyle = '#f2f6f9';
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(this.m(i * 1.6), this.m(i * 0.6));
      c.lineTo(this.m(i * 1.6 + 1.6), this.m(i * 0.6));
      c.lineTo(this.m(i * 1.6 + .8), this.m(i * 0.6 + 1.3));
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  bollard(x, y) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = .2;
    c.fillStyle = '#040f18';
    c.beginPath(); c.arc(this.m(x + .35), this.m(y + .4), this.m(.85), 0, TAU); c.fill();
    c.globalAlpha = 1;
    const g = c.createRadialGradient(this.m(x - .2), this.m(y - .2), this.m(.05), this.m(x), this.m(y), this.m(.85));
    g.addColorStop(0, '#9aa6b0');
    g.addColorStop(1, '#4c5560');
    c.fillStyle = g;
    c.beginPath(); c.arc(this.m(x), this.m(y), this.m(.8), 0, TAU); c.fill();
    c.strokeStyle = 'rgba(20,28,36,.55)'; c.lineWidth = this.m(.1); c.stroke();
    c.beginPath(); c.arc(this.m(x), this.m(y), this.m(.42), 0, TAU);
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.stroke();
    c.restore();
  }

  pedGlyph(x, y) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = .3;
    c.fillStyle = '#dfe9f0';
    const s = this.m(.42);
    c.beginPath(); c.arc(this.m(x), this.m(y) - s * 1.5, s * .55, 0, TAU); c.fill();
    c.fillRect(this.m(x) - s * .5, this.m(y) - s * .8, s, s * 1.8);
    c.fillRect(this.m(x) - s * .8, this.m(y) + s * 1.0, s * .6, s * 1.4);
    c.fillRect(this.m(x) + s * .2, this.m(y) + s * 1.0, s * .6, s * 1.4);
    c.restore();
  }

  /* -------------------------------------------------------------- minimap -- */
  bakeMinimap() {
    const c = this.miniCtx;
    const k = MINIMAP_PPU;
    const L = this.layout;
    const P = L.palette;
    c.fillStyle = '#0a2033';
    c.fillRect(0, 0, this.mini.width, this.mini.height);
    // water
    c.fillStyle = '#14496b';
    c.fillRect(0, 0, this.mini.width, L.world.waterLine * k);
    // areas
    const areaColors = { quay: '#5d6a74', yard: '#4f5b64', warehouse: '#4a5560', gate: '#3f4952', maintenance: '#48535c', training: '#3d5964' };
    for (const a of L.areas) {
      c.fillStyle = areaColors[a.id] || '#4a5560';
      c.fillRect(a.rect.x * k, a.rect.y * k, a.rect.w * k, a.rect.h * k);
    }
    // roads
    c.fillStyle = '#2c343b';
    for (const r of L.roads) if (r.w > 0) c.fillRect(r.rect.x * k, r.rect.y * k, r.rect.w * k, r.rect.h * k);
    // buildings
    c.fillStyle = '#7d8a95';
    for (const b of L.buildings) c.fillRect(b.rect.x * k, b.rect.y * k, b.rect.w * k, b.rect.h * k);
    // yard blocks
    c.fillStyle = 'rgba(34,200,184,.30)';
    for (const blk of L.yardBlocks) {
      c.fillRect(blk.rect.x * k, blk.rect.y * k, blk.rect.w * k, blk.rect.h * k);
    }
    // berths
    c.fillStyle = 'rgba(255,197,61,.4)';
    for (const b of L.berths) c.fillRect((b.x - b.length / 2) * k, 30 * k, b.length * k, 2 * k);
    // training pads
    c.fillStyle = 'rgba(34,200,184,.5)';
    for (const p of L.trainingPads) c.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
    // gate lanes
    c.fillStyle = 'rgba(255,197,61,.35)';
    for (const s of L.truckSpots) c.fillRect((s.x - 24) * k, (s.y - 1) * k, 24 * k, 2 * k);
    c.strokeStyle = 'rgba(147,190,220,.25)';
    c.lineWidth = 1;
    c.strokeRect(.5, .5, this.mini.width - 1, this.mini.height - 1);
  }
}

export default TerrainRenderer;
