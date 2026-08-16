/**
 * Every color in this repo has to be a color the golden set defines.
 *
 * `npm run vendor:brand` plus a clean `git diff` already proves the vendored
 * files are byte-exact, so nothing here re-checks them. This covers what the
 * diff cannot: the CSS share writes itself - shell.css, print.css, nt-code.css,
 * favicon.svg, the print footer in export.ts - where a one-off hex compiles
 * fine, renders close enough to fool a reviewer, and then survives a brand
 * correction it should have followed.
 *
 * A literal is allowed only where tokens.css names that exact color, which
 * keeps `var(--line, #2A2A2E)` legal and a hand-picked grey illegal. It does
 * not ask that the literal sit inside a `var()` fallback; that judgment needs
 * a reader, and SKILL.md is what the reader checks against.
 */
import { readFile, glob } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** tokens.css is the definition, so it is read rather than checked. */
const TOKENS = 'public/tokens.css';
const SCAN = ['public/*.css', 'public/vendor/**/*.css', 'public/*.svg', 'src/**/*.ts'];

const HEX = /#([0-9a-fA-F]{3,8})\b/g;
const RGB = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g;

/** `rgb(231, 90, 124)` and `#E75A7C` are one color; compare them as one. */
function colorsIn(text) {
  const found = new Map(); // RRGGBB -> the literal as written
  for (const m of text.matchAll(HEX)) {
    const h = m[1];
    const rgb = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
    found.set(rgb.toUpperCase(), m[0]);
  }
  for (const m of text.matchAll(RGB)) {
    const rgb = [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
    found.set(rgb.toUpperCase(), `${m[0]})`);
  }
  return found;
}

const allowed = colorsIn(await readFile(join(root, TOKENS), 'utf8'));
const fails = [];

for (const pattern of SCAN) {
  for await (const abs of glob(join(root, pattern))) {
    const path = relative(root, abs).split('\\').join('/');
    if (path === TOKENS) continue;
    for (const [rgb, literal] of colorsIn(await readFile(abs, 'utf8'))) {
      if (allowed.has(rgb)) continue;
      fails.push(`${path}: ${literal} is not a color the brand defines`);
    }
  }
}

if (fails.length) {
  console.error('brand: off-palette color\n');
  for (const f of fails) console.error(`  - ${f}`);
  console.error(`\nUse a var() off ${TOKENS}. If the color is genuinely new, add it to the`);
  console.error('golden set in notambourine/claude first, then `npm run vendor:brand`.');
  process.exit(1);
}

console.log(`brand: every color outside ${TOKENS} is one of its ${allowed.size}`);
