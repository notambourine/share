import type { Env, Meta } from '../lib/types';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { readMeta } from '../lib/r2';
import { jsonResponse, htmlResponse, textResponse, now } from '../lib/http';
import { errorShell } from '../render/shell';
import { publicUrl } from './upload';
import { isExpired } from '../lib/r2';

/**
 * GET /<space>/: Bearer only. Anonymous gets the same 404 as a missing page,
 * so a space never confirms its own existence.
 */
export async function listSpace(request: Request, env: Env, space: string): Promise<Response> {
  const auth = await authenticate(request, env);
  // A valid-signature session (live or expired) is a proven insider, so the
  // scope refusal leaks nothing; strangers still get the plain 404.
  if (auth.session || auth.expired) return textResponse(SESSION_SCOPE_MSG, 401);
  if (!auth.name) return htmlResponse(errorShell(404), 404);

  const origin = new URL(request.url).origin;
  const t = now();
  const hashes: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `${space}/`, delimiter: '/', cursor });
    for (const p of page.delimitedPrefixes) {
      hashes.push(p.slice(space.length + 1).replace(/\/$/, ''));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && hashes.length < 1000);

  const metas: Meta[] = [];
  for (let i = 0; i < hashes.length; i += 20) {
    const batch = await Promise.all(
      hashes.slice(i, i + 20).map((h) => readMeta(env, space, h)),
    );
    for (const m of batch) if (m) metas.push(m);
  }
  metas.sort((a, b) => b.createdAt - a.createdAt);

  return jsonResponse(metas.map((m) => ({
    hash: m.hash,
    url: publicUrl(origin, m),
    tier: m.tier,
    uploader: m.uploader,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    idleTtl: m.idleTtl,
    expired: isExpired(m, t),
    files: m.files.length,
    bytes: m.files.reduce((n, f) => n + f.size, 0),
  })));
}
