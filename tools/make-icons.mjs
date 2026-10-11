#!/usr/bin/env node
/**
 * make-icons.mjs — turn the SVG sources in assets/icons into everything the
 * desktop and Android wrappers need.
 *
 *   npm i --no-save @resvg/resvg-js   (pure npm package, no native tools)
 *   node tools/make-icons.mjs
 *
 * Reads : assets/icons/icon.svg, splash.svg
 * Writes: assets/icons/icon.png (1024), icon-256.png, icon.ico (16..256, PNG-compressed),
 *         assets/icons/splash.png, and android/app/src/main/res/mipmap-* launcher icons.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let Resvg;
for (const base of [ROOT, process.env.PPX_MODULES || '/tmp/pptr']) {
  try { ({ Resvg } = require(require.resolve('@resvg/resvg-js', { paths: [base] }))); break; } catch { /* next */ }
}
if (!Resvg) { console.error('Install the rasteriser first: npm i --no-save @resvg/resvg-js'); process.exit(1); }

const dir = path.join(ROOT, 'assets', 'icons');
const render = (file, width) => new Resvg(fs.readFileSync(path.join(dir, file)), { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng();
const write = (p, buf) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); console.log('  ' + path.relative(ROOT, p)); };

write(path.join(dir, 'icon.png'), render('icon.svg', 1024));
write(path.join(dir, 'icon-256.png'), render('icon.svg', 256));
if (fs.existsSync(path.join(dir, 'splash.svg'))) write(path.join(dir, 'splash.png'), render('splash.svg', 1920));

// .ico with several PNG-compressed sizes (Windows Vista+ reads these natively)
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => render('icon.svg', s));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
write(path.join(dir, 'icon.ico'), Buffer.concat([head, ...entries, ...pngs]));

// Android launcher icons (only if the Capacitor project exists)
const res = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, px] of Object.entries(dens)) {
    const png = render('icon.svg', px);
    write(path.join(res, `mipmap-${d}`, 'ic_launcher.png'), png);
    write(path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), png);
  }
}
console.log('icons done');
