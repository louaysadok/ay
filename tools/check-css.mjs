#!/usr/bin/env node
/**
 * check-css.mjs — stylesheet coverage audit.
 *
 * The UI is built from JS template strings, so a typo in a class name silently
 * produces an unstyled element. This tool collects every class token the app
 * can emit (markup + JS literals) and every class token the stylesheets define,
 * then reports the difference in both directions.
 *
 *   node tools/check-css.mjs            # report + exit 1 when classes are unused in CSS
 *   node tools/check-css.mjs --quiet    # report only, exit 0
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const CSS_DIR = join(root, 'styles');
const files = { html: [join(root, 'index.html')], js: [], css: [] };

function walk(dir, out, filter) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, filter);
    else if (filter(name)) out.push(p);
  }
  return out;
}
walk(join(root, 'src'), files.js, (n) => n.endsWith('.js'));
walk(CSS_DIR, files.css, (n) => n.endsWith('.css'));

/* ------------------------------------------------------------ CSS side ---- */
const cssClasses = new Set();
for (const f of files.css) {
  const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // only look at selector text (everything before a `{`)
  for (const m of text.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1];
    if (/^\s*@/.test(sel)) continue;
    for (const c of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(c[1]);
  }
}

/* --------------------------------------------------------- emit side ------ */
const emitted = new Map();   // token -> Set(files)
const add = (tok, file) => {
  if (!tok) return;
  if (!emitted.has(tok)) emitted.set(tok, new Set());
  emitted.get(tok).add(file);
};
const clean = (s) => s.replace(/[`{}<>]/g, '').trim();

function scanMarkup(text, file) {
  const split = (val) => {
    for (const tok of String(val).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      const c = clean(tok);
      // a trailing dash means the token is a prefix built at runtime (`tag medal-${m}`)
      if (/^[-_a-zA-Z]/.test(c) && !c.endsWith('-')) add(c, file);
    }
  };
  for (const m of text.matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) split(m[1] ?? m[2] ?? '');
  for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) split(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of text.matchAll(/classList\.(?:add|remove|toggle)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g)) split(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of text.matchAll(/setAttribute\(\s*['"]class['"]\s*,\s*([^)]+)\)/g)) split(m[1].replace(/['"`]/g, ''));
  // querySelector style hooks that rely on a class
  for (const m of text.matchAll(/querySelector(?:All)?\(\s*['"`]\.([\w-]+)/g)) add(m[1], file);
}
for (const f of files.html) scanMarkup(readFileSync(f, 'utf8'), relative(root, f));
for (const f of files.js) scanMarkup(readFileSync(f, 'utf8'), relative(root, f));

/* -------------------------------------------------------------- report ---- */
const missing = [...emitted.entries()]
  .filter(([tok]) => !cssClasses.has(tok))
  .map(([tok, where]) => `${tok}  (${[...where].join(', ')})`)
  .sort();
const unused = [...cssClasses].filter((c) => !emitted.has(c)).sort();

const quiet = process.argv.includes('--quiet');
console.log(`classes: ${cssClasses.size} in CSS · ${emitted.size} emitted`);
if (missing.length) {
  console.log(`\n✗ ${missing.length} class name(s) with no CSS rule:`);
  for (const line of missing) console.log('   ' + line);
} else {
  console.log('\n✓ every emitted class has a CSS rule');
}
if (unused.length) {
  console.log(`\n· ${unused.length} CSS class(es) not referenced by markup/JS:`);
  console.log('   ' + unused.join(', '));
}
process.exit(missing.length && !quiet ? 1 : 0);
