import type { Env } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import { authenticate } from '../lib/auth';
import { readMeta, isExpired } from '../lib/r2';
import { mintToken } from '../lib/sign';
import { genSlug, isValidSpace, isValidHash, parseDuration } from '../lib/keys';
import { jsonResponse, now } from '../lib/http';
import { publicUrl } from './upload';

interface SignBody {
  path?: string;
  ttl?: string;
  short?: boolean;
}

/** "acme/Ab12Cd34Ef56", "/acme/Ab12.../", or a full share URL -> [space, hash]. */
export function parseArtifactPath(raw: string): [string, string] | null {
  let p = raw.trim();
  try {
    if (p.includes('://')) p = new URL(p).pathname;
  } catch {
    return null;
  }
  const segs = p.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const [space, hash] = segs;
  if (!isValidSpace(space) || !isValidHash(hash)) return null;
  return [space, hash];
}

/**
 * POST /sign: Bearer required. Unauthenticated minting would let anyone
 * holding an expired link issue themselves a fresh one.
 */
export async function mint(request: Request, env: Env): Promise<Response> {
  const who = await authenticate(request, env.TOKENS);
  if (!who) return jsonResponse({ error: 'unauthorized' }, 401);

  let body: SignBody;
  try {
    body = await request.json<SignBody>();
  } catch {
    return jsonResponse({ error: 'expected JSON body {path, ttl?, short?}' }, 400);
  }
  const parsed = body.path && parseArtifactPath(body.path);
  if (!parsed) return jsonResponse({ error: 'path must be <space>/<hash>' }, 400);
  const [space, hash] = parsed;

  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  const ttlSecs = body.ttl ? parseDuration(body.ttl) : DEFAULT_LINK_DAYS * 86400;
  if (ttlSecs === null) return jsonResponse({ error: 'bad ttl' }, 400);
  const exp = ttlSecs === 0 ? 0 : t + ttlSecs;

  let keys: Record<string, string>;
  try {
    keys = JSON.parse(env.SIGNING_KEYS);
  } catch {
    return jsonResponse({ error: 'signing keys misconfigured' }, 500);
  }
  const token = await mintToken(keys, `${space}/${hash}`, exp);

  const origin = new URL(request.url).origin;
  const base = `${origin}/${space}/${hash}/k/${token}/`;
  const single = meta.files.length === 1 && meta.files[0].path !== 'index.html'
    ? encodeURI(meta.files[0].path) : '';
  const url = base + single;

  const out: Record<string, unknown> = { url, exp, tier: meta.tier };
  if (meta.tier === 'open') {
    // A signed link to an open artifact works, but the plain URL is shorter.
    out.note = 'artifact is open tier; the unsigned URL also works';
    out.openUrl = publicUrl(origin, meta);
  }

  if (body.short) {
    const id = genSlug(8);
    await env.LINKS.put(
      `z/${id}`,
      JSON.stringify({ target: url }),
      exp === 0 ? {} : { expirationTtl: Math.max(60, exp - t) },
    );
    out.short = `${origin}/z/${id}`;
  }

  return jsonResponse(out);
}
