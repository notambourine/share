import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/* Vite has no equivalent of wrangler's `rules` Text loader and would hand back an
   asset URL, so tests/static.test.ts would import a path where the worker sees text. */
export default defineConfig({
  plugins: [
    {
      name: 'md-as-text',
      enforce: 'pre',
      load(id) {
        if (!id.endsWith('.md')) return null;
        return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
      },
    },
  ],
});
