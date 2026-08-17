import { describe, expect, it } from 'vitest';
import { ROBOTS, SHELL_CSP } from '../src/lib/http';
import { isStatic, staticAsset } from '../src/worker';
import { brandSheet, DECK_THEME, TOKENS, LOCKUP } from '../src/brand';
import { homeShell } from '../src/render/shell';
import { testEnv } from './bindings';

const envWith = (body: string) => testEnv({
  assets: { fetch: async () => new Response(body, { headers: { 'content-type': 'font/woff2' } }) },
});

/** Echoes back the path ASSETS was asked for, which is what an alias changes. */
const envEcho = () => testEnv({
  assets: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) },
});

describe('isStatic', () => {
  it('serves the self-hosted fonts, so no page falls back to Google', () => {
    expect(isStatic('/fonts/nunito-latin-var.woff2')).toBe(true);
    expect(isStatic('/fonts/hanken-grotesk-latin-var-italic.woff2')).toBe(true);
    expect(isStatic('/fonts/jetbrains-mono-latin-var.woff2')).toBe(true);
    expect(isStatic('/fonts/OFL.txt')).toBe(true);
  });

  it('keeps the existing static set and vendor prefix', () => {
    expect(isStatic('/shell.css')).toBe(true);
    expect(isStatic('/vendor/marp/marpit.js')).toBe(true);
    expect(isStatic('/robots.txt')).toBe(true);
    expect(isStatic('/admin.js')).toBe(true);
  });

  /* The landing page wears the same header as an artifact shell, and that
     header inlines the lockup out of the bundle, so ASSETS cannot build it. */
  it('leaves the landing page to the bundle', () => {
    expect(isStatic('/')).toBe(false);
    expect(isStatic('/index.html')).toBe(false);
  });

  it('serves the logo, and the root paths a browser asks for unprompted', () => {
    expect(isStatic('/logo/favicon.svg')).toBe(true);
    expect(isStatic('/logo/export/apple-touch-icon.png')).toBe(true);
    expect(isStatic('/logo/site.webmanifest')).toBe(true);
    expect(isStatic('/favicon.svg')).toBe(true);
    expect(isStatic('/favicon.ico')).toBe(true);
    expect(isStatic('/apple-touch-icon.png')).toBe(true);
  });

  /* isStatic still says yes to the deck theme's URL because it sits under
     /vendor/. worker.ts asks brandSheet first, which is the ordering this
     guards: swap the two and the route 404s off a missing asset. */
  it('leaves the brand sheets to the bundle, not to ASSETS', () => {
    expect(isStatic('/tokens.css')).toBe(false);
    expect(brandSheet('/tokens.css')).toBeInstanceOf(Response);
    expect(brandSheet('/vendor/marp/nt-marp.css')).toBeInstanceOf(Response);
    expect(brandSheet('/shell.css')).toBeNull();
  });
});

describe('brand', () => {
  /* Vite owns `.css` and would hand back a style-injection shim, which would
     serve an empty stylesheet while every other test still passed. The length
     assertions are what make that failure loud. */
  it('imports the golden set as text, not as an asset URL', () => {
    /* One assertion per part, because /tokens.css is the three joined here and
       a dropped import would still serve a plausible-looking stylesheet. */
    expect(TOKENS).toContain("src: url('./fonts/nunito-latin-var.woff2')");
    expect(TOKENS).toContain('--nt-pink:        #E75A7C;');
    expect(TOKENS).toContain('--font-wordmark');
    expect(TOKENS).toContain('h1, h2, h3, h4, .display {');
    expect(TOKENS).not.toContain('@import');
    expect(TOKENS.length).toBeGreaterThan(5000);

    expect(DECK_THEME).toContain('/* @theme nt */');
    expect(DECK_THEME).toContain('section.lead');
    expect(DECK_THEME.length).toBeGreaterThan(2000);
  });

  /* Marpit needs the theme as a string in the same isolate. A deck PDF renders
     with no page to fetch from, so an ASSETS round-trip here was always a
     detour, and this is what keeps the export reading the import. */
  it('serves the deck theme as css, and it is the same string the export uses', async () => {
    const res = brandSheet('/vendor/marp/nt-marp.css');
    expect(res?.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(res?.headers.get('x-robots-tag')).toBe(ROBOTS);
    expect(await res?.text()).toBe(DECK_THEME);
  });

  /* Same trap as the stylesheets: Vite hands back an asset URL for an svg
     unless the config intercepts it, and a header holding the string
     "/assets/lockup-a1b2.svg" would render as nothing with every other test
     still green. `fill` is what shell.css overrides with currentColor. */
  it('imports the lockup as markup, not as an asset URL', () => {
    expect(LOCKUP).toMatch(/^<svg\b/);
    expect(LOCKUP).toContain('viewBox=');
    expect(LOCKUP).toContain('fill="#E75A7C"');
    expect(LOCKUP.length).toBeGreaterThan(2000);
  });

  /* The wordmark is artwork now, so no shell may typeset the name in Nunito.
     A stray --font-wordmark would render the fallback and nobody would look. */
  it('draws the wordmark rather than setting it in type', () => {
    const html = homeShell();
    expect(html).toContain(LOCKUP);
    expect(html).toContain('aria-label="NoTambourine"');
    expect(html).not.toContain('--font-wordmark');
    expect(html).toContain('rel="manifest"');
  });

  it('never swallows a share path', () => {
    expect(isStatic('/acme/Xk92mQ7bTp01/deck.md')).toBe(false);
    expect(isStatic('/fontsy/thing.png')).toBe(false);
    expect(isStatic('/up/acme')).toBe(false);
  });
});

describe('SHELL_CSP', () => {
  /* The fonts moved on-origin to stop leaking artifact URLs to Google as a
     Referer. An off-origin allowance creeping back would undo that silently. */
  it('names no external origin, and allows the self-hosted fonts', () => {
    expect(SHELL_CSP).not.toMatch(/https?:/);
    expect(SHELL_CSP).toContain("font-src 'self'");
  });
});

describe('staticAsset', () => {
  it('stamps x-robots-tag on a font, same as every other asset', async () => {
    const res = await staticAsset(new Request('https://s.test/fonts/nunito-latin-var.woff2'), envWith('woff2'));
    expect(res.headers.get('x-robots-tag')).toBe(ROBOTS);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('content-type')).toBe('font/woff2');
  });

  /* public/logo/ holds the only bytes, so a root icon has to be rewritten
     rather than copied. A copy is what would drift on the next kit bump. */
  it('rewrites a root icon onto the golden set, and passes everything else through', async () => {
    const at = async (path: string) => (
      await staticAsset(new Request(`https://s.test${path}`), envEcho())
    ).text();
    expect(await at('/favicon.svg')).toBe('/logo/favicon.svg');
    expect(await at('/favicon.ico')).toBe('/logo/export/favicon.ico');
    expect(await at('/apple-touch-icon.png')).toBe('/logo/export/apple-touch-icon.png');
    expect(await at('/apple-touch-icon-precomposed.png')).toBe('/logo/export/apple-touch-icon.png');
    expect(await at('/logo/favicon.svg')).toBe('/logo/favicon.svg');
    expect(await at('/shell.css')).toBe('/shell.css');
  });
});
