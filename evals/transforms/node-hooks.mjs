/* Two sync module hooks, so the eval can import the Worker's own render path
   instead of standing up a second one. `src/render/markdown.ts` reaches
   `src/brand.ts`, which imports stylesheets and an svg as text modules, and the
   whole graph writes relative imports without an extension the way a bundler
   resolves them. Node does neither. vitest.config.ts solves the same problem
   with Vite plugins; this is that, for plain node.

   Import this before anything that pulls src/render/. */

import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(spec, context, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(spec, context);
  },
  load(url, context, next) {
    if (!/\.(css|svg)$/.test(new URL(url).pathname)) return next(url, context);
    const text = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)};` };
  },
});
