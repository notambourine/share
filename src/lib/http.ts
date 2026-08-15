export const ROBOTS = 'noindex, nofollow, noarchive, noimageindex';

/** 10 minutes, so a revoke lands (R3). Private: client material skips shared caches. */
export const CACHE = 'private, max-age=600';

/** Self-only. Fonts and renderers are all vendored, so no origin is allowed out. */
export const SHELL_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function htmlResponse(html: string, status = 200, extra?: Record<string, string>): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': ROBOTS,
      'cache-control': CACHE,
      'vary': 'Accept',
      'content-security-policy': SHELL_CSP,
      'referrer-policy': 'no-referrer',
      ...extra,
    },
  });
}

export function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(obj, null, 2)}\n`, {
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

export function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
