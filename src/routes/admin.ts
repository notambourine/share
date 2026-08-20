import type { Env, Meta } from '../lib/types';
import { ADMIN_SECS, mintAdminLink, mintAdminToken, verifyAdminToken } from '../lib/admin';
import { authorize, requireKeys } from '../lib/auth';
import type { SigningKeys } from '../lib/sign';
import { readMeta, writeMeta, isExpired } from '../lib/r2';
import { parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { expiryText } from '../render/shell';
import { jsonResponse } from '../lib/http';
import { now } from '../lib/clock';
import type { RenderedKey } from '../lib/exportPath';
import { derivedPrefix, formatsFor, parseCheckKey, parseDerivedKey, renderedKey } from '../lib/exportPath';
import { type SlideCheck, decodeSlideCheck } from '../lib/pdf';

/** The `?c=` credential: this artifact's admin token, and the clock both
    handlers then read. No Bearer, so it never touches the vault map. */
async function adminToken(
  request: Request, env: Env, space: string, hash: string,
): Promise<{ keys: SigningKeys; t: number } | Response> {
  const keys = requireKeys(env, 'json');
  if (keys instanceof Response) return keys;
  const t = now();
  const c = new URL(request.url).searchParams.get('c');
  if (!c || !(await verifyAdminToken(keys, space, hash, c, t)).ok) {
    return jsonResponse({ error: `admin link missing or expired; re-open: nt-share admin ${space}/${hash}` }, 401);
  }
  return { keys, t };
}

/**
 * POST /<space>/<hash>/config?c=<token>: the admin page's one write, `{ttl}`.
 * Answers a fresh 5-minute token - the sliding window is a new credential per
 * edit, never a longer exp on the old one - plus the expiry it committed.
 */
export async function adminConfig(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const admin = await adminToken(request, env, space, hash);
  if (admin instanceof Response) return admin;
  const { keys, t } = admin;

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

  const exp = t + ADMIN_SECS;
  return jsonResponse({
    c: await mintAdminToken(keys, space, hash, exp),
    exp,
    expiresAt,
    // Rendered here, so the page never restates the countdown grammar.
    expiry: expiryText(updated, t),
  });
}

interface SourceStatus {
  path: string;
  /** The catalog keys whose render has landed, e.g. `slides.pdf`. Binary
      formats only: the html views render per request and never land anywhere. */
  rendered: RenderedKey[];
  check: SlideCheck | null;
}

/**
 * GET /<space>/<hash>/status?c=<token>: readiness of the derived formats plus
 * the overflow verdict, for the admin page's poll and the model's check. Pure
 * reads - hitting this can never spend a browser minute. Admin credential
 * because which slides clip is sender-only material.
 */
export async function adminStatus(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const admin = await adminToken(request, env, space, hash);
  if (admin instanceof Response) return admin;
  const { t } = admin;

  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  // Every renderable source answers, so an empty `rendered` reads as pending.
  // HTML sources ride along for the page exports; their check stays null.
  const sources = new Map<string, SourceStatus>();
  for (const f of meta.files) {
    if (formatsFor(f.path).length) sources.set(f.path, { path: f.path, rendered: [], check: null });
  }

  const prefix = derivedPrefix(space, hash);
  const checkKeys: [SourceStatus, string][] = [];
  for (const { key } of (await env.BUCKET.list({ prefix })).objects) {
    const rest = key.slice(prefix.length);
    const judged = parseCheckKey(rest);
    if (judged !== null) {
      const status = sources.get(judged);
      if (status) checkKeys.push([status, key]);
      continue;
    }
    const parsed = parseDerivedKey(rest);
    if (!parsed) continue;
    const status = sources.get(parsed.source);
    if (status) status.rendered.push(renderedKey(parsed.mode, parsed.ext));
  }
  for (const [status, key] of checkKeys) {
    const obj = await env.BUCKET.get(key);
    if (obj) status.check = decodeSlideCheck(await obj.text());
  }

  return jsonResponse({
    tier: meta.tier,
    /* Every path, not just the renderable ones: `nt-share fix` lands its repair
       as a new artifact, and a deck's images have to ride along or the fix
       quietly drops them. Sender-only material, which is why it answers here
       rather than on the public listing. */
    files: meta.files.map((f) => f.path),
    sources: [...sources.values()].map(({ path, rendered, check }) => ({ path, rendered: rendered.sort(), check })),
  });
}

/**
 * POST /<space>/<hash>/admin: re-mint the admin link. Vault token only,
 * mirroring /sign - this credential writes and deletes, so it inherits the
 * write-verb bar and a session stays capped at /up.
 */
export async function adminRemint(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const gate = await authorize(request, env, { need: 'vault', flavor: 'json', keys: 'required' });
  if (gate instanceof Response) return gate;

  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  return jsonResponse({ ...await mintAdminLink(gate.keys, new URL(request.url).origin, space, hash, t) });
}
