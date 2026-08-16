/* Copies pinned renderer builds out of node_modules into public/vendor/, and
   the brand's font binaries out of the `upstream/brand-kit` submodule.

   Run after bumping a pinned version in package.json or the submodule. The
   output is committed, because Workers Builds deploys the tree as it stands and
   runs no build step. That is also why deploys never reach a CDN: client
   material deserves no third-party runtime script.

   tokens.css and the deck theme are deliberately absent. src/brand.ts imports
   those from the submodule and the Worker serves them out of the bundle, so
   they are never copied and can never drift. Only the woff2 files are copied,
   because a static asset server is the right thing to serve a font and a font
   is an upstream artifact rather than a brand decision. scripts/brand-audit.mjs
   hashes them against the submodule to keep that copy honest. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { root, fontPairs } from './brand.mjs';

const COPIES = [
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'public/vendor/highlight/highlight.min.js'],
  ['node_modules/marked/lib/marked.umd.js', 'public/vendor/marked/marked.min.js'],
];

for (const [from, to] of [...COPIES, ...await fontPairs()]) {
  await mkdir(join(root, dirname(to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}

/* Marpit publishes CommonJS for Node only, so unlike the copies above it has to
   be bundled to reach a browser. IIFE keeps the no-CDN contract and the
   self-only CSP: one pinned file, no import resolution at runtime.
   Imported here, not at the top: `--brand` must run under --ignore-scripts,
   where esbuild's platform binary was never unpacked. */
const { build } = await import('esbuild');
const MARPIT_OUT = 'public/vendor/marp/marpit.js';
await mkdir(join(root, dirname(MARPIT_OUT)), { recursive: true });
await build({
  entryPoints: [join(root, 'node_modules/@marp-team/marpit/lib/index.js')],
  outfile: join(root, MARPIT_OUT),
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'Marpit',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log(`@marp-team/marpit -> ${MARPIT_OUT}`);
