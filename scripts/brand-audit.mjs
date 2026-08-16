/**
 * Two checks the bundle cannot make for itself.
 *
 * `tokens.css` and the deck theme need no check at all: src/brand.ts imports
 * them out of the submodule, so bumping the pin is the whole update and a stale
 * copy cannot exist. What is left is everything that could not be an import.
 *
 * 1. The fonts. They are copied into public/ because a static asset server is
 *    the right thing to serve a woff2, so they can go stale in the one way an
 *    import cannot. Hashed against the submodule, offline, no lock file.
 *
 * 2. Every color this repo writes itself. shell.css, print.css, nt-code.css,
 *    favicon.svg, and the print footer in export.ts are share's own CSS, where
 *    a hand-picked hex compiles fine, renders close enough to fool a reviewer,
 *    and then survives a brand correction it should have followed. A literal is
 *    allowed only where tokens.css names that exact color, which keeps
 *    `var(--line, #2A2A2E)` legal and a one-off grey illegal.
 *
 * 3. Every token this repo reads. `var(--x)` against a property the golden set
 *    no longer defines is the failure with no symptom: CSS falls through to the
 *    fallback, or to nothing, and the page still renders. The deck theme shipped
 *    for months reading `var(--fg-mute)`, which tokens.css has never defined.
 *    This is the contract a submodule bump has to clear.
 */
import { createHash } from 'node:crypto';
import { readFile, glob } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { root, BRAND, fontPairs } from './brand.mjs';

const TOKENS = `${BRAND}/tokens.css`;
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

const sha = async (p) => createHash('sha256').update(await readFile(join(root, p))).digest('hex');
const fails = [];

for (const [from, to] of await fontPairs()) {
  if (await sha(from) !== await sha(to)) {
    fails.push(`${to} differs from ${from}. Run \`npm run vendor\`.`);
  }
}

const tokensCss = await readFile(join(root, TOKENS), 'utf8');
const allowed = colorsIn(tokensCss);
const defined = new Set([...tokensCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

for (const pattern of SCAN) {
  for await (const abs of glob(join(root, pattern))) {
    const path = relative(root, abs).split('\\').join('/');
    const text = await readFile(abs, 'utf8');

    for (const [rgb, literal] of colorsIn(text)) {
      if (allowed.has(rgb)) continue;
      fails.push(`${path}: ${literal} is not a color the brand defines`);
    }

    /* A file may define its own property, so only an undefined read is a break. */
    const local = new Set([...text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (defined.has(m[1]) || local.has(m[1])) continue;
      fails.push(`${path}: var(${m[1]}) reads a token the golden set does not define`);
    }
  }
}

if (fails.length) {
  console.error('brand: drift\n');
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\nColors come from a var() off the golden set. If one is genuinely new,');
  console.error('add it in notambourine/claude first, then bump the submodule.');
  process.exit(1);
}

console.log(`brand: fonts match the golden set; every color is one of its ${allowed.size},`);
console.log(`       every var() reads one of its ${defined.size} tokens`);
