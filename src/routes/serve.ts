import type { Env, Meta } from '../lib/types';
import { readMeta, isExpired } from '../lib/r2';
import { verifyToken } from '../lib/sign';
import { viewModeFor } from '../lib/negotiate';
import { contentTypeFor } from '../lib/keys';
import { fileShell, dirShell, errorShell } from '../render/shell';
import { htmlResponse, now, ROBOTS, CACHE } from '../lib/http';

const DAY = 86400;

export async function serve(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  space: string,
  hash: string,
  token: string | null,
  rest: string,
): Promise<Response> {
  const meta = await readMeta(env, space, hash);
  const t = now();
  if (!meta || isExpired(meta, t)) return htmlResponse(errorShell(404), 404);

  if (meta.tier === 'signed') {
    if (!token) return htmlResponse(errorShell(401), 401);
    let keys: Record<string, string>;
    try {
      keys = JSON.parse(env.SIGNING_KEYS);
    } catch {
      return htmlResponse(errorShell(401), 401);
    }
    const v = await verifyToken(keys, `${space}/${hash}`, token, t);
    if (!v.ok) return htmlResponse(errorShell(401), 401);
  }

  // Idle-TTL uploads pay the bookkeeping: at most one meta rewrite per day.
  if (meta.idleTtl !== null && t - meta.lastAccess > DAY) {
    const updated: Meta = { ...meta, lastAccess: t };
    ctx.waitUntil(
      env.BUCKET.put(`${space}/${hash}/meta.json`, JSON.stringify(updated), {
        httpMetadata: { contentType: 'application/json' },
      }),
    );
  }

  const url = new URL(request.url);

  let filePath = rest;
  if (filePath === '') {
    if (meta.files.some((f) => f.path === 'index.html')) {
      filePath = 'index.html';
    } else {
      return htmlResponse(dirShell(hash, meta.files));
    }
  }

  const file = meta.files.find((f) => f.path === filePath);
  if (!file) return htmlResponse(errorShell(404), 404);

  const mode = viewModeFor(filePath, request.headers.get('accept'), url.searchParams);
  const rawHref = `${url.origin}${url.pathname}${url.pathname.endsWith('/') ? 'index.html' : ''}?raw`;

  switch (mode) {
    case 'shell-image': return htmlResponse(fileShell('image', filePath, rawHref, file.size));
    case 'shell-video': return htmlResponse(fileShell('video', filePath, rawHref, file.size));
    case 'shell-svg': return htmlResponse(fileShell('svg', filePath, rawHref, file.size));
    case 'shell-code': return htmlResponse(fileShell('code', filePath, rawHref, file.size));
    case 'shell-md': return htmlResponse(fileShell('md', filePath, rawHref, file.size));
    case 'shell-slides': return htmlResponse(fileShell('slides', filePath, rawHref, file.size));
    case 'shell-download': return htmlResponse(fileShell('download', filePath, rawHref, file.size));
    default:
      return rawBytes(request, env, `${space}/${hash}/f/${filePath}`, filePath, mode === 'attachment');
  }
}

/** Single-range support so <video> seeking works; anything malformed falls back to a full 200. */
function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { offset: start, length: end - start + 1 };
}

async function rawBytes(
  request: Request, env: Env, key: string, filePath: string, attachment: boolean,
): Promise<Response> {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const headers = new Headers({
    'content-type': contentTypeFor(filePath),
    'x-robots-tag': ROBOTS,
    'cache-control': CACHE,
    'vary': 'Accept',
    'cross-origin-resource-policy': 'cross-origin',
    'accept-ranges': 'bytes',
  });
  if (attachment) {
    headers.set('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
  }

  if (request.method === 'HEAD') {
    const head = await env.BUCKET.head(key);
    if (!head) return htmlResponse(errorShell(404), 404);
    headers.set('content-length', String(head.size));
    headers.set('etag', head.httpEtag);
    return new Response(null, { status: 200, headers });
  }

  const head = await env.BUCKET.head(key);
  if (!head) return htmlResponse(errorShell(404), 404);
  const range = parseRange(request.headers.get('range'), head.size);

  const obj = await env.BUCKET.get(key, range ? { range } : undefined);
  if (!obj) return htmlResponse(errorShell(404), 404);
  headers.set('etag', obj.httpEtag);

  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set('content-length', String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(head.size));
  return new Response(obj.body, { status: 200, headers });
}
