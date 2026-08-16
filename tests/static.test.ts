import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { ROBOTS, SHELL_CSP } from '../src/lib/http';
import { isStatic, staticAsset } from '../src/worker';
import { brandSheet, DECK_THEME, BRAND_ROUTES } from '../src/brand';

const envWith = (body: string) => ({
  ASSETS: { fetch: async () => new Response(body, { headers: { 'content-type': 'font/woff2' } }) },
} as unknown as Env);

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
    expect(isStatic('/')).toBe(true);
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
    const tokens = BRAND_ROUTES['/tokens.css'];
    expect(tokens).toContain('--nt-pink:        #E75A7C;');
    expect(tokens).toContain('--font-wordmark');
    expect(tokens.length).toBeGreaterThan(5000);

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
  it('stamps x-robots-tag on a font, same as every other asset (R2)', async () => {
    const res = await staticAsset(new Request('https://s.test/fonts/nunito-latin-var.woff2'), envWith('woff2'));
    expect(res.headers.get('x-robots-tag')).toBe(ROBOTS);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res.headers.get('content-type')).toBe('font/woff2');
  });
});
