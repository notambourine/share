import type { Deferrals, Env } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import { readMetaTagged, writeMeta, isExpired } from '../lib/r2';
import { mintToken, parseSigningKeys, verifyToken } from '../lib/sign';
import { verifyAdminToken } from '../lib/admin';
import { viewModeFor } from '../lib/negotiate';
import { resolveExport } from '../lib/exportPath';
import { exportArtifact } from './export';
import { rawBytes } from '../lib/bytes';
import { fileShell, dirShell, errorShell, adminShell } from '../render/shell';
import { htmlResponse, now } from '../lib/http';

const DAY = 86400;

export async function serve(
  request: Request,
  env: Env,
  ctx: Deferrals,
  space: string,
  hash: string,
  token: string | null,
  rest: string,
): Promise<Response> {
  const tagged = await readMetaTagged(env, space, hash);
  const t = now();
  if (!tagged || isExpired(tagged.meta, t)) return htmlResponse(errorShell(404), 404);
  const { meta, etag } = tagged;

  const url = new URL(request.url);

  /* A live `?c=` wins the artifact root, checked ahead of the signed-tier 401:
     admin implies view. Invalid, absent, or expired falls through to today's
     view, never a 401 of its own. Root only - a file path ignores c=. */
  if (rest === '') {
    const c = url.searchParams.get('c');
    const keys = c && parseSigningKeys(env);
    if (c && keys && (await verifyAdminToken(keys, space, hash, c, t)).ok) {
      /* The page's links must travel, so on the signed tier they ride a fresh
         view token at the /sign default life - the admin holder is the
         uploader, and handing out links is the page's job. */
      const kSeg = meta.tier === 'signed'
        ? `k/${await mintToken(keys, `${space}/${hash}`, t + DEFAULT_LINK_DAYS * 86400)}/`
        : '';
      return htmlResponse(adminShell({ meta, origin: url.origin, kSeg, now: t }));
    }
  }

  if (meta.tier === 'signed') {
    if (!token) return htmlResponse(errorShell(401), 401);
    const keys = parseSigningKeys(env);
    if (!keys) return htmlResponse(errorShell(401), 401);
    const v = await verifyToken(keys, `${space}/${hash}`, token, t);
    if (!v.ok) return htmlResponse(errorShell(401), 401);
  }

  // Idle-TTL uploads pay the bookkeeping: at most one meta rewrite per day.
  // Conditional on the etag read above, so it can never clobber an admin TTL
  // edit that landed in between; losing a day's touch to that race is nothing.
  if (meta.idleTtl !== null && t - meta.lastAccess > DAY) {
    ctx.waitUntil(writeMeta(env, { ...meta, lastAccess: t }, etag));
  }

  let filePath = rest;
  if (filePath === '') {
    if (meta.files.some((f) => f.path === 'index.html')) {
      filePath = 'index.html';
    } else {
      return htmlResponse(dirShell(hash, meta.files));
    }
  }

  const file = meta.files.find((f) => f.path === filePath);
  if (!file) {
    /* Exact match first, then the format suffixes, so a file uploaded as
       `notes.pdf` serves its own bytes instead of re-rendering `notes`. */
    const wanted = resolveExport(meta.files.map((f) => f.path), filePath);
    if (!wanted) return htmlResponse(errorShell(404), 404);
    const src = meta.files.find((f) => f.path === wanted.source);
    if (!src) return htmlResponse(errorShell(404), 404);
    return exportArtifact(request, env, {
      space, hash, url, source: wanted.source, format: wanted.format, size: src.size,
    });
  }

  const mode = viewModeFor(filePath, request.headers.get('accept'), url.searchParams);
  const rawHref = `${url.origin}${url.pathname}${url.pathname.endsWith('/') ? 'index.html' : ''}?raw`;

  switch (mode) {
    case 'shell-image': return htmlResponse(fileShell('image', filePath, rawHref, file.size));
    case 'shell-video': return htmlResponse(fileShell('video', filePath, rawHref, file.size));
    case 'shell-svg': return htmlResponse(fileShell('svg', filePath, rawHref, file.size));
    case 'shell-code': return htmlResponse(fileShell('code', filePath, rawHref, file.size));
    case 'shell-md': return htmlResponse(fileShell('md', filePath, rawHref, file.size));
    case 'shell-download': return htmlResponse(fileShell('download', filePath, rawHref, file.size));
    default:
      return rawBytes(request, env, `${space}/${hash}/f/${filePath}`, filePath, mode === 'attachment');
  }
}
