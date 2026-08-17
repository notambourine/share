import type { Env } from '../lib/types';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { verifyAdminToken } from '../lib/admin';
import { parseSigningKeys } from '../lib/sign';
import { moveToTrash } from '../lib/r2';
import { now, textResponse } from '../lib/http';

/** The `?c=` admin token authorizes exactly this artifact's delete, nothing
    wider, so it never touches `authenticate` or the vault map. */
async function adminAuthorized(
  request: Request, env: Env, space: string, hash: string,
): Promise<boolean> {
  const c = new URL(request.url).searchParams.get('c');
  if (!c) return false;
  const keys = parseSigningKeys(env);
  if (!keys) return false;
  return (await verifyAdminToken(keys, space, hash, c, now())).ok;
}

/* DELETE /<space>/<hash>/: soft delete into _trash/ (90-day lifecycle rule purges).
   Deletion is the whole revoke story; a per-link denylist would cost a KV read per view.
   Two credentials: a raw vault token, or a live `?c=` admin token. Sessions stay refused. */
export async function del(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  if (!(await adminAuthorized(request, env, space, hash))) {
    const auth = await authenticate(request, env);
    if (auth.session || auth.expired) return textResponse(SESSION_SCOPE_MSG, 401);
    if (!auth.name) return textResponse('unauthorized\n', 401);
  }
  const moved = await moveToTrash(env, space, hash);
  if (moved === 0) return textResponse('no such artifact\n', 404);
  return new Response(null, { status: 204, headers: { 'x-robots-tag': 'noindex' } });
}
