import type { Env } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import { authenticate, SESSION_SCOPE_MSG } from '../lib/auth';
import { readMeta, isExpired } from '../lib/r2';
import { parseSigningKeys } from '../lib/sign';
import { mintArtifactLink, publicUrl } from '../lib/link';
import { isValidSpace, isValidHash, parseDuration } from '../lib/keys';
import { jsonResponse, now } from '../lib/http';

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
  const auth = await authenticate(request, env);
  // A live-or-expired session proved itself with a valid signature, so the
  // scope refusal leaks nothing; sign stays raw-only to cap an exfil at /up.
  if (auth.session || auth.expired) return jsonResponse({ error: SESSION_SCOPE_MSG.trim() }, 401);
  if (!auth.name) return jsonResponse({ error: 'unauthorized' }, 401);

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

  const keys = parseSigningKeys(env);
  if (!keys) return jsonResponse({ error: 'signing keys misconfigured' }, 500);

  const origin = new URL(request.url).origin;
  const link = await mintArtifactLink(env, keys, origin, meta, exp, t, !!body.short);

  const out: Record<string, unknown> = { ...link, tier: meta.tier };
  if (meta.tier === 'open') {
    // A signed link to an open artifact works, but the plain URL is shorter.
    out.note = 'artifact is open tier; the unsigned URL also works';
    out.openUrl = publicUrl(origin, meta);
  }
  return jsonResponse(out);
}
