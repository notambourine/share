/* Copies pinned renderer builds out of node_modules into public/vendor/.
   Run after bumping a pinned version in package.json; the output is committed,
   so deploys never fetch from a CDN (client material deserves no third-party
   runtime script). nt-code.css / nt-marp.css beside them are ours. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const COPIES = [
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'public/vendor/highlight/highlight.min.js'],
  ['node_modules/marked/lib/marked.umd.js', 'public/vendor/marked/marked.min.js'],
];

for (const [from, to] of COPIES) {
  await mkdir(join(root, dirname(to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}

/* Marpit publishes CommonJS for Node only, so unlike the copies above it has to
   be bundled to reach a browser. IIFE keeps the no-CDN contract and the
   self-only CSP: one pinned file, no import resolution at runtime. */
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
