import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { ROBOTS, SHELL_CSP } from '../src/lib/http';
import { isStatic, staticAsset } from '../src/worker';

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
    expect(isStatic('/tokens.css')).toBe(true);
    expect(isStatic('/vendor/marp/marpit.js')).toBe(true);
    expect(isStatic('/')).toBe(true);
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
