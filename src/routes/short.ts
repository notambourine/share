import type { Env } from '../lib/types';
import { parseObject, textAt } from '../lib/json';
import { htmlResponse, ROBOTS } from '../lib/http';
import { errorShell } from '../render/shell';

/** GET /z/<id>: 302 to the signed URL. KV expirationTtl already handled expiry. */
export async function short(env: Env, id: string): Promise<Response> {
  if (!/^[A-Za-z0-9]{4,16}$/.test(id)) return htmlResponse(errorShell(404), 404);
  const stored = await env.LINKS.get(`z/${id}`);
  const record = stored === null ? null : parseObject(stored);
  const target = record && textAt(record, 'target');
  if (!target) return htmlResponse(errorShell(404), 404);
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'x-robots-tag': ROBOTS,
      'cache-control': 'no-store',
    },
  });
}
