/**
 * The brand's golden set, served from the bundle rather than from public/.
 *
 * These imports are load-bearing, the same way `src/skill.ts` imports SKILL.md:
 * they make drift between what this Worker serves and what nt-brand defines
 * impossible, where a copy under public/ could only ever be detected after the
 * fact. Bumping `upstream/nt-brand` is the whole update - there is no second
 * step, so there is nothing to forget.
 *
 * The fonts stay on the ASSETS path. They are inert binaries rather than brand
 * decisions, a static server is the right thing to serve them, and tokens.css
 * asks for them at `./fonts/*.woff2`, which resolves to `/fonts/` either way.
 */
import TOKENS from '../upstream/nt-brand/plugins/nt-brand/skills/system/tokens.css';
import DECK from '../upstream/nt-brand/plugins/nt-brand/skills/system/deck.css';
import { ROBOTS } from './lib/http';

/** Marpit takes a theme as a string, so the export and the browser both read this. */
export { DECK as DECK_THEME };

/* The paths these answer on. `/vendor/marp/nt-marp.css` keeps its name: it is
   what public/render.js fetches, and the URL is the theme's, not the file's. */
export const BRAND_ROUTES: Record<string, string> = {
  '/tokens.css': TOKENS,
  '/vendor/marp/nt-marp.css': DECK,
};

export function brandSheet(path: string): Response | null {
  const css = BRAND_ROUTES[path];
  if (css === undefined) return null;
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': 'public, max-age=3600',
    },
  });
}
