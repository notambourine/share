/* Copies pinned upstreams into public/. Two of them:
   - the brand, out of the `upstream/nt-brand` submodule (`npm run vendor:brand`)
   - the renderer builds, out of node_modules (`npm run vendor:deps`)

   The output is committed either way, because Workers Builds deploys the tree
   as it stands and runs no build step. That is also why deploys never reach a
   CDN: client material deserves no third-party runtime script.

   `vendor:brand` is a pure file copy so it runs under `npm ci --ignore-scripts`,
   which is what lets CI re-run it and diff the result. `vendor:deps` bundles
   with esbuild and needs a full install, so it stays a local command. */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = process.argv[2] ?? '--all';

/* The golden set: `notambourine/claude`, plugin nt-brand, skill system. Pinned
   as a submodule so Dependabot can open the bump PR, and copied rather than
   symlinked so `public/` holds real bytes for the asset server. */
const BRAND = 'upstream/nt-brand/plugins/nt-brand/skills/system';

const BRAND_COPIES = [
  [`${BRAND}/tokens.css`, 'public/tokens.css'],
  /* Marpit takes a theme as a string, so this one is read by the Worker rather
     than linked by a page. The name is the theme's, not the file's origin. */
  [`${BRAND}/deck.css`, 'public/vendor/marp/nt-marp.css'],
];

const DEP_COPIES = [
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'public/vendor/highlight/highlight.min.js'],
  ['node_modules/marked/lib/marked.umd.js', 'public/vendor/marked/marked.min.js'],
];

async function copyAll(pairs) {
  for (const [from, to] of pairs) {
    await mkdir(join(root, dirname(to)), { recursive: true });
    await copyFile(join(root, from), join(root, to));
    console.log(`${from} -> ${to}`);
  }
}

if (stage === '--brand' || stage === '--all') {
  let faces;
  try {
    faces = await readdir(join(root, BRAND, 'fonts'));
  } catch {
    console.error(`${BRAND} is empty. Run \`git submodule update --init\` first.`);
    process.exit(1);
  }
  await copyAll([
    ...BRAND_COPIES,
    ...faces.map((f) => [`${BRAND}/fonts/${f}`, `public/fonts/${f}`]),
  ]);
  if (stage === '--brand') process.exit(0);
}

await copyAll(DEP_COPIES);

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
