/**
 * The brand's golden set, served from the bundle rather than from public/.
 *
 * These imports are load-bearing, the same way `src/skill.ts` imports SKILL.md:
 * they make drift between what this Worker serves and what brand-kit defines
 * impossible, where a copy under public/ could only ever be detected after the
 * fact. Bumping `upstream/brand-kit` is the whole update - there is no second
 * step, so there is nothing to forget.
 *
 * The fonts stay on the ASSETS path. They are inert binaries rather than brand
 * decisions, a static server is the right thing to serve them, and tokens.css
 * asks for them at `./fonts/*.woff2`, which resolves to `/fonts/` either way.
 */
/* The kit's tokens.css is three @import lines, for a page that links it off a
   disk. Serving that would cost three more routes and three more requests, so
   the parts are joined here and /tokens.css stays one file on the wire. */
import FONTS from '../upstream/brand-kit/fonts.css';
import VARS from '../upstream/brand-kit/vars.css';
import ELEMENTS from '../upstream/brand-kit/elements.css';
import DECK from '../upstream/brand-kit/deck.css';
/* Inline rather than `<img src="/logo/lockup.svg">`: a PDF header and an
   offline `.html` snapshot both have to carry the mark with no origin to fetch
   from, and inline is also the only form `fill: currentColor` can reach. */
import LOCKUP from '../upstream/brand-kit/logo/lockup.svg';
import { ROBOTS } from './lib/http';

/** The three parts joined, so /tokens.css is one file on the wire and the PDF
    export inlines the same string the browser gets. */
export const TOKENS = [FONTS, VARS, ELEMENTS].join('\n');

/* First declaration wins: the raw palette sits at the top of vars.css and the
   `.theme-light` remaps below it only ever redefine semantic tokens. */
const TOKEN_VALUES = new Map<string, string>();
for (const [, name, value] of VARS.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
  if (!TOKEN_VALUES.has(name)) TOKEN_VALUES.set(name, value.trim());
}

/** Read a token's literal value, for the few places a `var()` cannot reach. */
export function token(name: string): string {
  const value = TOKEN_VALUES.get(name);
  if (value === undefined) throw new Error(`brand: ${name} is not a token the golden set declares`);
  return value;
}

/** The wordmark, outlined, so no page has to load Nunito to render it. */
export { LOCKUP };

/** Marpit takes a theme as a string, so the export and the browser both read this. */
export { DECK as DECK_THEME };

/* The paths these answer on. Nothing in this repo fetches the deck theme any
   more - `src/render/markdown.ts` hands `DECK_THEME` straight to Marpit, which
   scopes it and returns CSS the page inlines - but the URL stays published, so a
   deck built outside this Worker can link the same theme. */
const BRAND_ROUTES = new Map([
  ['/tokens.css', TOKENS],
  ['/vendor/marp/nt-marp.css', DECK],
]);

export function brandSheet(path: string): Response | null {
  const css = BRAND_ROUTES.get(path);
  if (css === undefined) return null;
  return new Response(css, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': 'public, max-age=3600',
    },
  });
}
