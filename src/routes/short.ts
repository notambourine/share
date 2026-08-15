import type { Env } from '../lib/types';
import { htmlResponse, ROBOTS } from '../lib/http';
import { errorShell } from '../render/shell';

/** GET /z/<id> — 302 to the signed URL. KV expirationTtl already handled expiry. */
export async function short(env: Env, id: string): Promise<Response> {
  if (!/^[A-Za-z0-9]{4,16}$/.test(id)) return htmlResponse(errorShell(404), 404);
  const rec = await env.LINKS.get<{ target: string }>(`z/${id}`, 'json');
  if (!rec?.target) return htmlResponse(errorShell(404), 404);
  return new Response(null, {
    status: 302,
    headers: {
      location: rec.target,
      'x-robots-tag': ROBOTS,
      'cache-control': 'no-store',
    },
  });
}
