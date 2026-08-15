/** Serving R2 objects: ranges, HEAD, ETags. Shared by uploaded files and
    derived artifacts, so a cached PDF behaves like any other byte payload. */

import type { Env } from './types';
import { contentTypeFor } from './keys';
import { errorShell } from '../render/shell';
import { htmlResponse, ROBOTS, CACHE } from './http';

/** Single-range support so <video> seeking works; anything malformed falls back to a full 200. */
export function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
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

export async function rawBytes(
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
