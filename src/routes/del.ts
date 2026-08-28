import type { Env } from '../lib/types';
import { authorize } from '../lib/auth';
import { verifyAdminToken } from '../lib/admin';
import { parseSigningKeys } from '../lib/sign';
import { moveToTrash } from '../lib/r2';
import { textResponse, ROBOTS } from '../lib/http';
import { now } from '../lib/clock';

/** The `?c=` admin token authorizes exactly this artifact's delete, nothing
    wider, so it never touches the vault map. Keys it cannot parse are a silent
    no rather than a 500: the vault token still deletes without them. */
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
   Two credentials: a raw vault token, or a live `?c=` working-page token. */
export async function del(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  if (!(await adminAuthorized(request, env, space, hash))) {
    const gate = await authorize(request, env, { flavor: 'text' });
    if (gate instanceof Response) return gate;
  }
  const moved = await moveToTrash(env, space, hash);
  if (moved === 0) return textResponse('no such artifact\n', 404);
  return new Response(null, { status: 204, headers: { 'x-robots-tag': ROBOTS } });
}
