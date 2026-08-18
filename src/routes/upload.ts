import type { Env, Meta, MetaFile, Tier } from '../lib/types';
import { DEFAULT_ARTIFACT_DAYS, DEFAULT_LINK_DAYS } from '../lib/types';
import { genSlug, normalizeUploadPath, contentTypeFor, isValidSpace, parseDuration } from '../lib/keys';
import { posterParent } from '../lib/poster';
import { authorize } from '../lib/auth';
import { mintArtifactLink, publicUrl } from '../lib/link';
import { mintAdminLink } from '../lib/admin';
import { payloadKey, writeMeta } from '../lib/r2';
import { decodeNumberMap } from '../lib/json';
import { jsonResponse, textResponse, wantsJson, now } from '../lib/http';
import { MAX_TRANSFORM_BYTES, TRANSFORMS, runTransform, transformable } from '../transforms';

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
  /* Signing your own fresh upload spends no authority the upload did not, so a
     session token covers both and the signed tier costs one 1Password unlock.
     Keys ride along for every tier: the admin link mints from the same set, and
     missing keys only block the signed tier below - an open upload still lands,
     just without its admin link. */
  const gate = await authorize(request, env, { need: 'upload', flavor: 'text' });
  if (gate instanceof Response) return gate;
  const { name: uploader, keys } = gate;
  if (!isValidSpace(space)) return textResponse('invalid space name\n', 400);

  const url = new URL(request.url);
  const t = now();

  const tierParam = url.searchParams.get('tier') ?? 'open';
  if (tierParam !== 'open' && tierParam !== 'signed') {
    return textResponse('tier must be open or signed\n', 400);
  }
  const tier: Tier = tierParam;

  const transform = url.searchParams.get('transform');
  if (transform !== null && !TRANSFORMS.has(transform)) {
    return textResponse(`unknown transform (${[...TRANSFORMS.keys()].join(', ')})\n`, 400);
  }
  const ai = env.AI;
  if (transform !== null && !ai) {
    return textResponse('transform unavailable: no AI binding\n', 503);
  }

  let linkExp = 0;
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

  /* Before any byte lands, so a failed transform stores nothing, and before
     the poster grouping, so `seen` still matches the paths. Only the text
     files rewrite; a deck's images ride along untouched. */
  if (transform !== null && ai) {
    const sources = entries.filter((e) => transformable(e.path));
    if (sources.length === 0) return textResponse('transform needs a .md or .txt file\n', 400);
    for (const e of sources) {
      if (e.blob.size > MAX_TRANSFORM_BYTES) {
        return textResponse(`too large to transform: ${e.path}\n`, 413);
      }
      const out = await runTransform(ai, transform, e.path, await e.blob.text());
      if (out === null) return textResponse('transform failed; retry without transform=\n', 502);
      // A .txt would serve as text/plain and never render; the output is markdown now.
      const path = e.path.replace(/\.txt$/i, '.md');
      if (path !== e.path) {
        if (seen.has(path)) return textResponse(`duplicate path: ${path}\n`, 400);
        seen.delete(e.path);
        seen.add(path);
        e.path = path;
      }
      e.blob = new File([`${out}\n`], path.slice(path.lastIndexOf('/') + 1));
    }
  }

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

  const meta: Meta = {
    space, hash, tier, uploader,
    createdAt: t, expiresAt, idleTtl, lastAccess: t,
    ...(transform !== null && { transform }),
    files,
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
      ...(transform !== null && { transform }),
      ...(signed && { signedUrl: signed.url, signedExp: signed.exp, short: signed.short }),
      ...(admin && { adminUrl: admin.url, adminExp: admin.exp }),
    }, 201);
  }
  // The bare URL 401s on a signed artifact, so the signed one is the answer.
  return textResponse(`${signed ? signed.url : link}\n`, 201);
}
