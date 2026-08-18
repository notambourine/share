/* Copies the brand's fonts and logo out of `@notambourine/brand-kit`.

   Build output, not a committed artifact: `npm run build:client` runs this
   before it bundles src/client/, and Workers Builds runs that before it
   deploys. The version in package.json is the whole pin, so a Dependabot bump
   of the kit reaches the wire on the next deploy with nothing to re-run by
   hand and no window where the copy disagrees with the dep.

   The renderers used to be copied here too - highlight.js, marked, and a Marpit
   bundle, ~565 KB of parser that every viewer downloaded. They are imported
   into the Worker now (src/render/markdown.ts), so they reach a page as rendered
   markup rather than as a script tag and no copy of them belongs under public/.

   tokens.css and the deck theme are deliberately absent: src/brand.ts imports
   those from the dep and the Worker serves them out of the bundle, so they
   never touch the disk at all. Fonts and logo files are copied because a static
   asset server is the right thing to serve a woff2, a png, and an .ico, and a
   browser fetches `/logo/favicon.svg` on its own before any bundle code runs. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { root, brandCopies, clearBrandCopies } from './brand.mjs';

await clearBrandCopies();

for (const [from, to] of await brandCopies()) {
  await mkdir(join(root, dirname(to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}
