import type { Env, Meta } from '../lib/types';
import { mintAdminLink, mintAdminToken, refreshExp, verifyAdminToken } from '../lib/admin';
import { authorize, requireKeys } from '../lib/auth';
import type { SigningKeys } from '../lib/sign';
import { readMeta, writeMeta, isExpired } from '../lib/r2';
import { parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { expiryText } from '../render/shell';
import { jsonResponse } from '../lib/http';
import { now } from '../lib/clock';

/** The `?c=` credential: this artifact's working-page token, and the clock the
    handlers then read. No Bearer, so it never touches the vault map. */
export async function adminToken(
  request: Request, env: Env, space: string, hash: string,
): Promise<{ keys: SigningKeys; t: number; origin: number } | Response> {
  const keys = requireKeys(env, 'json');
  if (keys instanceof Response) return keys;
  const t = now();
  const c = new URL(request.url).searchParams.get('c');
  const v = c ? await verifyAdminToken(keys, space, hash, c, t) : null;
  if (!v?.ok) {
    return jsonResponse({ error: `admin link missing or expired; re-open: nt-share admin ${space}/${hash}` }, 401);
  }
  return { keys, t, origin: v.origin };
}

/**
 * POST /<space>/<hash>/config?c=<token>: the working page's expiry write,
 * `{ttl}`. Answers a fresh 5-minute token - the sliding window is a new
 * credential per edit, never a longer exp on the old one, and never past the
 * session's hour - plus the expiry it committed.
 */
export async function adminConfig(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const admin = await adminToken(request, env, space, hash);
  if (admin instanceof Response) return admin;
  const { keys, t, origin } = admin;

  const ttl = textAt(parseObject(await request.text()) ?? {}, 'ttl');
  if (!ttl) return jsonResponse({ error: 'expected JSON body {ttl}' }, 400);
  const secs = parseDuration(ttl);
  if (secs === null) return jsonResponse({ error: 'bad ttl' }, 400);

  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);
  // Counts from upload; a ttl the artifact has outlived counts from the
  // write instead, so no chip ever expires a share by side effect.
  const fromUpload = meta.createdAt + secs;
  const expiresAt = secs === 0 ? null : fromUpload > t ? fromUpload : t + secs;
  const updated: Meta = { ...meta, expiresAt };
  await writeMeta(env, updated);

  const exp = refreshExp(t, origin);
  return jsonResponse({
    c: await mintAdminToken(keys, space, hash, exp, origin),
    exp,
    expiresAt,
    // Rendered here, so the page never restates the countdown grammar.
    expiry: expiryText(updated, t),
  });
}

/**
 * POST /<space>/<hash>/admin: re-open the working page. Vault token only - this
 * credential generates, writes, and deletes, so it inherits the write-verb bar.
 */
export async function adminRemint(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const gate = await authorize(request, env, { flavor: 'json', keys: 'required' });
  if (gate instanceof Response) return gate;

  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  return jsonResponse({ ...await mintAdminLink(gate.keys, new URL(request.url).origin, space, hash, t) });
}
