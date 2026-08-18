import type { Env, Meta, MetaFile, Tier } from '../lib/types';
import { DEFAULT_ARTIFACT_DAYS, DEFAULT_LINK_DAYS } from '../lib/types';
import { genSlug, normalizeUploadPath, contentTypeFor, isValidSpace, parseDuration } from '../lib/keys';
import { posterParent } from '../lib/poster';
import { authenticate, SESSION_EXPIRED_MSG } from '../lib/auth';
import type { SigningKeys } from '../lib/sign';
import { parseSigningKeys } from '../lib/sign';
import { mintArtifactLink, publicUrl } from '../lib/link';
import { mintAdminLink } from '../lib/admin';
import { writeMeta } from '../lib/r2';
import { decodeNumberMap } from '../lib/json';
import { jsonResponse, textResponse, wantsJson, now } from '../lib/http';

const MAX_FILES = 200;

interface UploadEntry {
  path: string;
  blob: File;
}

function artifactDays(env: Env, space: string): number {
  const days = decodeNumberMap(env.SPACE_TTLS ?? '{}')[space];
  return days !== undefined && days > 0 ? days : DEFAULT_ARTIFACT_DAYS;
}

export async function upload(
  request: Request, env: Env, space: string,
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.name) return textResponse(auth.expired ? SESSION_EXPIRED_MSG : 'unauthorized\n', 401);
  const uploader = auth.name;
  if (!isValidSpace(space)) return textResponse('invalid space name\n', 400);

  const url = new URL(request.url);
  const t = now();

  const tierParam = url.searchParams.get('tier') ?? 'open';
  if (tierParam !== 'open' && tierParam !== 'signed') {
    return textResponse('tier must be open or signed\n', 400);
  }
  const tier: Tier = tierParam;

  /* Signing your own fresh upload spends no authority the upload did not, so a
     session token covers both and the signed tier costs one 1Password unlock.
     Keys parse for every tier: the admin link mints from the same set. Missing
     keys only block the signed tier - an open upload still lands, just without
     its admin link. */
  let linkExp = 0;
  const keys: SigningKeys | null = parseSigningKeys(env);
  const short = url.searchParams.has('short');
  if (tier === 'signed') {
    const signParam = url.searchParams.get('sign');
    const secs = signParam ? parseDuration(signParam) : DEFAULT_LINK_DAYS * 86400;
    if (secs === null) return textResponse('bad sign duration\n', 400);
    linkExp = secs === 0 ? 0 : t + secs;
    // Before a byte lands: a stored artifact with no link is a dead end.
    if (!keys) return textResponse('signing keys misconfigured\n', 500);
  }

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
    await env.BUCKET.put(`${space}/${hash}/f/${path}`, blob, {
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

  const meta: Meta = {
    space, hash, tier, uploader,
    createdAt: t, expiresAt, idleTtl, lastAccess: t, files,
  };
  await writeMeta(env, meta);

  /* No render at upload. A page is rendered by the request that asks for it and
     a PDF by the tile that is clicked, so an upload nobody opens spends none of
     the browser budget and a brand edit needs no backfill. */
  const link = publicUrl(url.origin, meta);
  const signed = tier === 'signed' && keys
    ? await mintArtifactLink(env, keys, url.origin, meta, linkExp, t, short) : null;
  // The sender's second link: TTL chips and delete, live 5 minutes from now.
  const admin = keys && await mintAdminLink(keys, url.origin, space, hash, t);

  if (wantsJson(request)) {
    return jsonResponse({
      url: link, hash, tier, expiresAt, files: files.map((f) => f.path),
      ...(signed && { signedUrl: signed.url, signedExp: signed.exp, short: signed.short }),
      ...(admin && { adminUrl: admin.url, adminExp: admin.exp }),
    }, 201);
  }
  // The bare URL 401s on a signed artifact, so the signed one is the answer.
  return textResponse(`${signed ? signed.url : link}\n`, 201);
}
