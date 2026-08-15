import type { Env, Meta, MetaFile, Tier } from '../lib/types';
import { DEFAULT_ARTIFACT_DAYS } from '../lib/types';
import { genSlug, normalizeUploadPath, contentTypeFor, isValidSpace, parseDuration } from '../lib/keys';
import { authenticate } from '../lib/auth';
import { prerender } from './export';
import { jsonResponse, textResponse, wantsJson, now } from '../lib/http';

const MAX_FILES = 200;

export function publicUrl(origin: string, meta: Meta): string {
  const base = `${origin}/${meta.space}/${meta.hash}/`;
  if (meta.files.length === 1 && meta.files[0].path !== 'index.html') {
    return base + encodeURI(meta.files[0].path);
  }
  return base;
}

function artifactDays(env: Env, space: string): number {
  try {
    const map = JSON.parse(env.SPACE_TTLS ?? '{}');
    const d = Number(map[space]);
    if (Number.isFinite(d) && d > 0) return d;
  } catch { /* fall through to the default */ }
  return DEFAULT_ARTIFACT_DAYS;
}

export async function upload(
  request: Request, env: Env, ctx: ExecutionContext, space: string,
): Promise<Response> {
  const uploader = await authenticate(request, env.TOKENS);
  if (!uploader) return textResponse('unauthorized\n', 401);
  if (!isValidSpace(space)) return textResponse('invalid space name\n', 400);

  const url = new URL(request.url);
  const t = now();

  const tierParam = url.searchParams.get('tier') ?? 'open';
  if (tierParam !== 'open' && tierParam !== 'signed') {
    return textResponse('tier must be open or signed\n', 400);
  }
  const tier: Tier = tierParam;

  let expiresAt: number | null;
  let idleTtl: number | null = null;
  const idleParam = url.searchParams.get('idle');
  const ttlParam = url.searchParams.get('ttl');
  if (idleParam) {
    idleTtl = parseDuration(idleParam);
    if (!idleTtl) return textResponse('bad idle duration\n', 400);
    expiresAt = null;
  } else if (ttlParam) {
    const secs = parseDuration(ttlParam);
    if (secs === null) return textResponse('bad ttl\n', 400);
    expiresAt = secs === 0 ? null : t + secs;
  } else {
    expiresAt = t + artifactDays(env, space) * 86400;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return textResponse('expected multipart/form-data\n', 400);
  }

  const entries: { path: string; blob: File }[] = [];
  const seen = new Set<string>();
  for (const [, value] of form.entries()) {
    if (typeof value === 'string') continue;
    const path = normalizeUploadPath(value.name);
    if (!path) return textResponse(`unsafe file path: ${value.name}\n`, 400);
    if (seen.has(path)) return textResponse(`duplicate path: ${path}\n`, 400);
    seen.add(path);
    entries.push({ path, blob: value });
  }
  if (entries.length === 0) return textResponse('no files (use -F f=@file)\n', 400);
  if (entries.length > MAX_FILES) return textResponse(`too many files (max ${MAX_FILES})\n`, 400);

  const hash = genSlug(12);
  const files: MetaFile[] = [];
  for (const { path, blob } of entries) {
    const type = contentTypeFor(path);
    await env.BUCKET.put(`${space}/${hash}/f/${path}`, blob, {
      httpMetadata: { contentType: type },
    });
    files.push({ path, size: blob.size, type });
  }

  const meta: Meta = {
    space, hash, tier, uploader,
    createdAt: t, expiresAt, idleTtl, lastAccess: t, files,
  };
  await env.BUCKET.put(`${space}/${hash}/meta.json`, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });

  /* Warm the export cache off the response path. The browser budget is the
     scarce resource, so this runs after meta.json lands and never blocks. */
  ctx.waitUntil(prerender(env, url, meta).catch((err) => {
    console.log(`prerender: ${space}/${hash} failed: ${err}`);
  }));

  const link = publicUrl(url.origin, meta);
  if (wantsJson(request)) {
    return jsonResponse({ url: link, hash, tier, expiresAt, files: files.map((f) => f.path) }, 201);
  }
  return textResponse(`${link}\n`, 201);
}
