import type { Env, Meta, MetaFile } from '../lib/types';
import { readMeta, isExpired } from '../lib/r2';
import { parseSigningKeys, verifyToken } from '../lib/sign';
import { viewModeFor } from '../lib/negotiate';
import { resolveExport } from '../lib/exportPath';
import { exportArtifact } from './export';
import { rawBytes } from '../lib/bytes';
import { fileShell, dirShell, errorShell } from '../render/shell';
import { htmlResponse, now } from '../lib/http';

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
    const keys = parseSigningKeys(env);
    if (!keys) return htmlResponse(errorShell(401), 401);
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
  if (!file) {
    /* Exact match first, then the format suffixes, so a file uploaded as
       `notes.pdf` serves its own bytes instead of re-rendering `notes`. */
    const wanted = resolveExport(meta.files.map((f) => f.path), filePath);
    if (!wanted) return htmlResponse(errorShell(404), 404);
    const src = meta.files.find((f) => f.path === wanted.source) as MetaFile;
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
    case 'shell-slides': return htmlResponse(fileShell('slides', filePath, rawHref, file.size));
    case 'shell-download': return htmlResponse(fileShell('download', filePath, rawHref, file.size));
    default:
      return rawBytes(request, env, `${space}/${hash}/f/${filePath}`, filePath, mode === 'attachment');
  }
}
