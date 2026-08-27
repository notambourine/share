import type { Env, Meta, MetaFile } from '../lib/types';
import { DEFAULT_ARTIFACT_DAYS } from '../lib/types';
import { genSlug, normalizeUploadPath, contentTypeFor, isValidSpace, parseDuration } from '../lib/keys';
import { posterParent } from '../lib/poster';
import { authorize } from '../lib/auth';
import { publicUrl } from '../lib/link';
import { mintAdminLink } from '../lib/admin';
import { payloadKey, writeMeta } from '../lib/r2';
import { jsonResponse, textResponse, wantsJson } from '../lib/http';
import { now } from '../lib/clock';

const MAX_FILES = 200;

interface UploadEntry {
  path: string;
  blob: File;
}

/**
 * POST /up/<space>: one request, one artifact. Nothing renders and nothing
 * generates here - a page is rendered by the request that asks for it, and a
 * document is generated from the working page this answers with - so an upload
 * nobody opens spends no browser and no inference budget.
 *
 * Keys ride along but are not required: missing keys only cost the working-page
 * link, and the upload still lands and still serves.
 */
export async function upload(
  request: Request, env: Env, space: string,
): Promise<Response> {
  const gate = await authorize(request, env, { flavor: 'text' });
  if (gate instanceof Response) return gate;
  const { name: uploader, keys } = gate;
  if (!isValidSpace(space)) return textResponse('invalid space name\n', 400);

  const url = new URL(request.url);
  const t = now();

  let expiresAt: number | null;
  const ttlParam = url.searchParams.get('ttl');
  if (ttlParam) {
    const secs = parseDuration(ttlParam);
    if (secs === null) return textResponse('bad ttl\n', 400);
    expiresAt = secs === 0 ? null : t + secs;
  } else {
    expiresAt = t + DEFAULT_ARTIFACT_DAYS * 86400;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return textResponse('expected multipart/form-data\n', 400);
  }

  const entries: UploadEntry[] = [];
  const seen = new Set<string>();
  for (const [, value] of form.entries()) {
    // A text field carries no name to key on, so only the files count.
    if (!(value instanceof File)) continue;
    const path = normalizeUploadPath(value.name);
    if (!path) return textResponse(`unsafe file path: ${value.name}\n`, 400);
    if (seen.has(path)) return textResponse(`duplicate path: ${path}\n`, 400);
    seen.add(path);
    entries.push({ path, blob: value });
  }
  if (entries.length === 0) return textResponse('no files (use -F f=@file)\n', 400);
  if (entries.length > MAX_FILES) return textResponse(`too many files (max ${MAX_FILES})\n`, 400);

  const hash = genSlug(12);
  /* A poster only counts as one when the file it names rode along; otherwise
     someone uploaded a picture that happens to be called that, and it keeps its
     own row. Bytes land either way - only the meta record differs. */
  const posters = new Map<string, string>();
  const payload: UploadEntry[] = [];
  for (const e of entries) {
    const parent = posterParent(e.path);
    if (parent !== null && seen.has(parent)) posters.set(parent, e.path);
    else payload.push(e);
  }

  for (const { path, blob } of entries) {
    await env.BUCKET.put(payloadKey(space, hash, path), blob, {
      httpMetadata: { contentType: contentTypeFor(path) },
    });
  }
  const files: MetaFile[] = payload.map(({ path, blob }) => {
    const poster = posters.get(path);
    return {
      path, size: blob.size, type: contentTypeFor(path),
      ...(poster && { poster }),
    };
  });

  const meta: Meta = { space, hash, uploader, createdAt: t, expiresAt, files };
  await writeMeta(env, meta);

  const link = publicUrl(url.origin, meta);
  // The sender's second link: generation, TTL chips, delete. Live 5 minutes.
  const admin = keys && await mintAdminLink(keys, url.origin, space, hash, t);

  if (wantsJson(request)) {
    return jsonResponse({
      url: link, hash, expiresAt, files: files.map((f) => f.path),
      ...(admin && { adminUrl: admin.url, adminExp: admin.exp }),
    }, 201);
  }
  return textResponse(`${link}\n`, 201);
}
