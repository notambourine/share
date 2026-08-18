/* Copies the brand's fonts and logo out of the `upstream/brand-kit` submodule.

   Run after bumping the submodule. This output is committed, because it is
   copied from a pin and changes only when that pin does. The browser code in
   src/client/ is the opposite case and is built at deploy time by
   scripts/client.mjs, never committed.

   The renderers used to be copied here too - highlight.js, marked, and a Marpit
   bundle, ~565 KB of parser that every viewer downloaded. They are imported
   into the Worker now (src/render/markdown.ts), so they reach a page as rendered
   markup rather than as a script tag and no copy of them belongs under public/.

   tokens.css and the deck theme are deliberately absent for the same reason.
   src/brand.ts imports those from the submodule and the Worker serves them out
   of the bundle, so they are never copied and can never drift. Fonts and logo
   files are copied because a static asset server is the right thing to serve a
   woff2, a png, and an .ico, and a browser fetches `/logo/favicon.svg` on its
   own before any bundle code runs. scripts/brand-audit.mjs hashes both against
   the submodule to keep that copy honest. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { root, brandCopies } from './brand.mjs';

for (const [from, to] of await brandCopies()) {
  await mkdir(join(root, dirname(to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}
