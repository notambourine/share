import type { Env, Meta } from '../lib/types';
import { authorize } from '../lib/auth';
import { readMeta, writeMeta, isExpired } from '../lib/r2';
import { parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { adminShell, errorShell, expiryText } from '../render/shell';
import { ADMIN_CSP, htmlResponse, jsonResponse } from '../lib/http';
import { now } from '../lib/clock';

/** GET /admin/<space>/<hash>/: the working page, the one shell that submits. */
export async function adminPage(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return htmlResponse(errorShell(404), 404);
  return htmlResponse(
    adminShell({ meta, origin: new URL(request.url).origin, now: t }),
    200,
    { 'content-security-policy': ADMIN_CSP, 'cache-control': 'no-store' },
  );
}

/** POST /admin/<space>/<hash>/config: the working page's expiry write, `{ttl}`. */
export async function adminConfig(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const gate = await authorize(request, env, 'json');
  if (gate instanceof Response) return gate;
  const t = now();

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

  // Rendered here, so the page never restates the countdown grammar.
  return jsonResponse({ expiresAt, expiry: expiryText(updated, t) });
}
