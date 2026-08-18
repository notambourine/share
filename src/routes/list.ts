import type { Env, Meta } from '../lib/types';
import { authorize } from '../lib/auth';
import { readMeta } from '../lib/r2';
import { jsonResponse, htmlResponse, now } from '../lib/http';
import { errorShell } from '../render/shell';
import { publicUrl } from '../lib/link';
import { isExpired } from '../lib/r2';

/**
 * GET /<space>/: Bearer only. Anonymous gets the same 404 as a missing page,
 * so a space never confirms its own existence.
 */
export async function listSpace(request: Request, env: Env, space: string): Promise<Response> {
  const gate = await authorize(request, env, {
    need: 'vault',
    flavor: 'text',
    anonymous: () => htmlResponse(errorShell(404), 404),
  });
  if (gate instanceof Response) return gate;

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
    expired: isExpired(m, t),
    files: m.files.length,
    bytes: m.files.reduce((n, f) => n + f.size, 0),
  })));
}
