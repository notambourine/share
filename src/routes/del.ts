import type { Env } from '../lib/types';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { moveToTrash } from '../lib/r2';
import { textResponse } from '../lib/http';

/* DELETE /<space>/<hash>/: soft delete into _trash/ (90-day lifecycle rule purges).
   Deletion is the whole revoke story; a per-link denylist would cost a KV read per view. */
export async function del(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth.session || auth.expired) return textResponse(SESSION_SCOPE_MSG, 401);
  if (!auth.name) return textResponse('unauthorized\n', 401);
  const moved = await moveToTrash(env, space, hash);
  if (moved === 0) return textResponse('no such artifact\n', 404);
  return new Response(null, { status: 204, headers: { 'x-robots-tag': 'noindex' } });
}
