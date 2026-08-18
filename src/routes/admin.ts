import type { Env, Meta } from '../lib/types';
import { ADMIN_SECS, mintAdminLink, mintAdminToken, verifyAdminToken } from '../lib/admin';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { parseSigningKeys } from '../lib/sign';
import { readMeta, readMetaTagged, writeMeta, isExpired } from '../lib/r2';
import { parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { jsonResponse, now } from '../lib/http';
import { CACHE_VERSION } from '../lib/exportPath';
import { type SlideCheck, decodeSlideCheck } from '../lib/pdf';

/**
 * POST /<space>/<hash>/config?c=<token>: the admin page's one write, `{ttl}`.
 * Answers a fresh 5-minute token - the sliding window is a new credential per
 * edit, never a longer exp on the old one - plus the expiry it committed.
 */
export async function adminConfig(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const keys = parseSigningKeys(env);
  if (!keys) return jsonResponse({ error: 'signing keys misconfigured' }, 500);
  const t = now();
  const c = new URL(request.url).searchParams.get('c');
  if (!c || !(await verifyAdminToken(keys, space, hash, c, t)).ok) {
    return jsonResponse({ error: `admin link missing or expired; re-open: nt-share admin ${space}/${hash}` }, 401);
  }

  const ttl = textAt(parseObject(await request.text()) ?? {}, 'ttl');
  if (!ttl) return jsonResponse({ error: 'expected JSON body {ttl}' }, 400);
  const secs = parseDuration(ttl);
  if (secs === null) return jsonResponse({ error: 'bad ttl' }, 400);

  // Conditional write with one retry: a lastAccess touch that lands in between
  // moves the etag, and this write must never silently lose.
  for (let attempt = 0; attempt < 2; attempt++) {
    const tagged = await readMetaTagged(env, space, hash);
    if (!tagged || isExpired(tagged.meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);
    // Counts from upload; a ttl the artifact has outlived counts from the
    // write instead, so no chip ever expires a share by side effect.
    const fromUpload = tagged.meta.createdAt + secs;
    const expiresAt = secs === 0 ? null : fromUpload > t ? fromUpload : t + secs;
    // The chip owns expiry outright: an idle rule from upload would keep a
    // "forever" or a fixed date lying, so it dies on first admin touch.
    const updated: Meta = { ...tagged.meta, expiresAt, idleTtl: null };
    if (await writeMeta(env, updated, tagged.etag)) {
      return jsonResponse({ c: await mintAdminToken(keys, space, hash, t + ADMIN_SECS), expiresAt });
    }
  }
  return jsonResponse({ error: 'write conflict; retry' }, 409);
}

interface SourceStatus {
  path: string;
  /** `<mode>.<ext>` pairs whose render has landed, e.g. `slides.pdf`. Binary
      formats only: the html views render per request and never land anywhere. */
  rendered: string[];
  check: SlideCheck | null;
}

/**
 * GET /<space>/<hash>/status?c=<token>: readiness of the derived formats plus
 * the overflow verdict, for the admin page's poll and the model's check. Pure
 * reads - hitting this can never spend a browser minute. Admin credential
 * because which slides clip is sender-only material.
 */
export async function adminStatus(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const keys = parseSigningKeys(env);
  if (!keys) return jsonResponse({ error: 'signing keys misconfigured' }, 500);
  const t = now();
  const c = new URL(request.url).searchParams.get('c');
  if (!c || !(await verifyAdminToken(keys, space, hash, c, t)).ok) {
    return jsonResponse({ error: `admin link missing or expired; re-open: nt-share admin ${space}/${hash}` }, 401);
  }

  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  // Every renderable source answers, so an empty `rendered` reads as pending.
  // HTML sources ride along for the page exports; their check stays null.
  const sources = new Map<string, SourceStatus>();
  for (const f of meta.files) {
    if (/\.(md|markdown|html?)$/i.test(f.path)) {
      sources.set(f.path, { path: f.path, rendered: [], check: null });
    }
  }

  const prefix = `${space}/${hash}/d/v${CACHE_VERSION}/`;
  const checkKeys: [SourceStatus, string][] = [];
  for (const { key } of (await env.BUCKET.list({ prefix })).objects) {
    const rest = key.slice(prefix.length);
    const m = /^(.*)\.(check\.json|(?:slides|doc)\.pdf|page\.(?:pdf|(?:browser|full)\.png))$/.exec(rest);
    const status = m && sources.get(m[1]);
    if (!status) continue;
    if (m[2] === 'check.json') checkKeys.push([status, key]);
    else status.rendered.push(m[2]);
  }
  for (const [status, key] of checkKeys) {
    const obj = await env.BUCKET.get(key);
    if (obj) status.check = decodeSlideCheck(await obj.text());
  }

  return jsonResponse({
    sources: [...sources.values()].map(({ path, rendered, check }) => ({ path, rendered: rendered.sort(), check })),
  });
}

/**
 * POST /<space>/<hash>/admin: re-mint the admin link. Vault token only,
 * mirroring /sign - this credential writes and deletes, so it inherits the
 * write-verb bar and a session stays capped at /up.
 */
export async function adminRemint(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.session || auth.expired) return jsonResponse({ error: SESSION_SCOPE_MSG.trim() }, 401);
  if (!auth.name) return jsonResponse({ error: 'unauthorized' }, 401);

  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  const keys = parseSigningKeys(env);
  if (!keys) return jsonResponse({ error: 'signing keys misconfigured' }, 500);
  return jsonResponse({ ...await mintAdminLink(keys, new URL(request.url).origin, space, hash, t) });
}
