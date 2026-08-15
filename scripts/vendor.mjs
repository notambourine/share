/* Copies pinned renderer builds out of node_modules into public/vendor/.
   Run after bumping a pinned version in package.json; the output is committed,
   so deploys never fetch from a CDN (client material deserves no third-party
   runtime script). nt-code.css / nt-reveal.css beside them are ours. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const COPIES = [
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'public/vendor/highlight/highlight.min.js'],
  ['node_modules/marked/lib/marked.umd.js', 'public/vendor/marked/marked.min.js'],
  ['node_modules/reveal.js/dist/reveal.js', 'public/vendor/reveal/reveal.js'],
  ['node_modules/reveal.js/dist/reveal.css', 'public/vendor/reveal/reveal.css'],
];

for (const [from, to] of COPIES) {
  await mkdir(join(root, dirname(to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}
