import type { Env } from '../lib/types';
import { authenticate } from '../lib/auth';
import { moveToTrash } from '../lib/r2';
import { textResponse } from '../lib/http';

/** DELETE /<space>/<hash>/: soft delete into _trash/ (90-day lifecycle rule purges). */
export async function del(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const who = await authenticate(request, env.TOKENS);
  if (!who) return textResponse('unauthorized\n', 401);
  const moved = await moveToTrash(env, space, hash);
  if (moved === 0) return textResponse('no such artifact\n', 404);
  return new Response(null, { status: 204, headers: { 'x-robots-tag': 'noindex' } });
}
