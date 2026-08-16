import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/* Vite has no equivalent of wrangler's `rules` Text loader and would hand back an
   asset URL, so tests/static.test.ts would import a path where the worker sees text. */

const asText = (id: string) => `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;

/* Vite tags a CSS id with `?used` or `?direct`, so the extension is not the end
   of the string the way it is for markdown. */
const file = (id: string) => id.split('?')[0];

/* The mark that takes a stylesheet out of Vite's hands. `\0` is Rollup's virtual
   module prefix and `.txt` is the load-bearing half: Vite's CSS plugins match on
   the extension, so an id merely prefixed with `\0` still ends in `.css` and
   still gets claimed. */
const VIRTUAL = '\0css-text:';
const virtual = (path: string) => `${VIRTUAL}${path}.txt`;
const actual = (id: string) => id.slice(VIRTUAL.length, -'.txt'.length);

export default defineConfig({
  plugins: [
    {
      name: 'md-as-text',
      enforce: 'pre',
      load(id) {
        return id.endsWith('.md') ? asText(id) : null;
      },
    },
    /* CSS cannot go through the same `load` hook. Vite owns `.css` natively and
       its pipeline overwrites whatever a plugin loads, handing back a
       style-injection shim - an empty default export under SSR. src/brand.ts
       would then serve an empty stylesheet with every other test still green,
       which is the failure tests/static.test.ts is written to catch. `?raw` does
       not save it either; the CSS plugin claims that too.

       So the id stops looking like CSS before Vite ever sees it. src/brand.ts
       stays clean, because wrangler's Text rule wants a plain path. */
    {
      name: 'css-as-text',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!source.endsWith('.css') || !importer) return null;
        const hit = await this.resolve(source, importer, { skipSelf: true });
        return hit ? virtual(file(hit.id)) : null;
      },
      load(id) {
        return id.startsWith(VIRTUAL) ? asText(actual(id)) : null;
      },
    },
  ],
});
