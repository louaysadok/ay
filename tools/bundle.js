#!/usr/bin/env node
/**
 * bundle.js — copy the game into dist/www, the folder that both wrappers ship.
 *
 *   node tools/bundle.js
 *
 * The game is plain ES modules + JSON + CSS, so "bundling" is a straight copy:
 * no transpiler, no minifier, no runtime dependency. Electron serves dist/www
 * through a private app:// scheme, Capacitor/Android serves it from the APK
 * assets (https://localhost inside the WebView) — both allow ES modules and
 * fetch(), which a plain file:// page would not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'www');
const INCLUDE = ['index.html', 'src', 'styles', 'assets'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0, bytes = 0;
function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n));
  } else {
    fs.copyFileSync(from, to);
    files++; bytes += st.size;
  }
}
for (const name of INCLUDE) {
  const from = path.join(ROOT, name);
  if (fs.existsSync(from)) copy(from, path.join(OUT, name));
}
// sanity check: the entry point must reference a module that was copied
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const m = html.match(/<script[^>]+src="([^"]+)"/);
if (!m || !fs.existsSync(path.join(OUT, m[1]))) {
  console.error('bundle: entry script missing from output');
  process.exit(1);
}
console.log(`bundle: ${files} files, ${(bytes / 1048576).toFixed(2)} MB -> ${path.relative(ROOT, OUT)}`);
