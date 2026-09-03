/* Bundles the browser code in src/client/ into public/*.js.

   Unlike scripts/vendor.mjs, this output is NOT committed: it is derived from
   TypeScript in this repo rather than copied from a pinned dependency, so a
   committed copy would be a second source of truth for code that changes with
   every PR. Workers Builds runs `npm run build:client` before it deploys, and
   the shells 404 on /render.js without it.

   IIFE, not ESM: the shells load these with a plain script tag and the CSP is
   self-only, so there is no import resolution at runtime. Bundling is also what
   lets src/client/ import src/lib/ - splitFrontMatter and the JSON decoders have
   one home now, and the client reads them rather than restating them. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './brand.mjs';

const ENTRIES = [
  ['src/client/render.ts', 'public/render.js'],
  ['src/client/admin.ts', 'public/admin.js'],
  ['src/client/print.ts', 'public/print.js'],
  ['src/client/table.ts', 'public/table.js'],
];

/* Imported here, not at the top, to match vendor.mjs: a script that runs under
   --ignore-scripts never had esbuild's platform binary unpacked. */
const { build } = await import('esbuild');

await mkdir(join(root, 'public'), { recursive: true });

for (const [from, to] of ENTRIES) {
  const out = await build({
    entryPoints: [join(root, from)],
    outfile: join(root, to),
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    /* The floor is what Workers' own headless Chrome runs plus the browsers a
       client opens a share link in. Nothing here needs a transpile below it. */
    target: 'es2022',
    legalComments: 'none',
    metafile: true,
  });
  const bytes = Object.values(out.metafile.outputs)[0].bytes;
  console.log(`${from} -> ${to} (${(bytes / 1024).toFixed(1)} KB)`);
}
