import type { Env } from '../lib/types';
import { authorize } from '../lib/auth';
import { moveToTrash } from '../lib/r2';
import { textResponse, ROBOTS } from '../lib/http';

/* DELETE /admin/<space>/<hash>/: soft delete into _trash/ (90-day lifecycle rule purges).
   Deletion is the whole revoke story; a per-link denylist would cost a KV read per view. */
export async function del(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  const moved = await moveToTrash(env, space, hash);
  if (moved === 0) return textResponse('no such artifact\n', 404);
  return new Response(null, { status: 204, headers: { 'x-robots-tag': ROBOTS } });
}
