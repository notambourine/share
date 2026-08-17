import type { Env, Meta } from '../lib/types';
import { ADMIN_SECS, mintAdminLink, mintAdminToken, verifyAdminToken } from '../lib/admin';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { parseSigningKeys } from '../lib/sign';
import { readMeta, readMetaTagged, writeMeta, isExpired } from '../lib/r2';
import { parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { jsonResponse, now } from '../lib/http';

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
