import type { Serializable } from './json';

export const ROBOTS = 'noindex, nofollow, noarchive, noimageindex';

/** 10 minutes, so a revoke lands. Private: client material skips shared caches. */
export const CACHE = 'private, max-age=600';

/* One URL answers three ways, so both keys have to be in Vary. Accept splits a
   browser from a hotlink; User-Agent splits an unfurl crawler from curl, which
   ask identically (see src/lib/negotiate.ts). Leave User-Agent out and a cache
   can hand a crawler's HTML to an <img src>. */
export const VARY = 'Accept, User-Agent';

/* Self-only. Fonts and renderers are all vendored, so no origin is allowed out.
   A Google Fonts @import would send every artifact URL to Google as a Referer. */
function csp(formAction: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "media-src 'self'",
    // The landing page links site.webmanifest; default-src 'none' would block it.
    "manifest-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    `form-action ${formAction}`,
  ].join('; ');
}

/** Every shell that can carry uploaded HTML, which is why it submits nowhere. */
export const SHELL_CSP = csp("'none'");

/** The working page, the one shell that submits: a generation is a POST
    navigation, so the new tab holds through the model call instead of polling.
    `'self'` and not `'none'`, and still not a wildcard - the only form here
    posts to a route on this origin that already demands the `?c=` token. */
export const ADMIN_CSP = csp("'self'");

export function htmlResponse(html: string, status = 200, extra?: Record<string, string>): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': CACHE,
      'vary': VARY,
      'content-security-policy': SHELL_CSP,
      'referrer-policy': 'no-referrer',
      ...extra,
    },
  });
}

export function jsonResponse(body: Serializable, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': 'no-store',
    },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': 'no-store',
    },
  });
}

/**
 * Where a POST navigation lands. Relative on purpose: the generate route sits at
 * `<space>/<hash>/generate`, so a bare filename resolves to its sibling and the
 * `?c=` token drops off - the version it just wrote is public.
 */
export function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'x-robots-tag': ROBOTS,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}
