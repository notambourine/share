import type { Env, Tier } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import { authorize } from '../lib/auth';
import { readMeta, isExpired } from '../lib/r2';
import { mintArtifactLink, publicUrl } from '../lib/link';
import { isValidSpace, isValidHash, parseDuration } from '../lib/keys';
import { parseObject, textAt } from '../lib/json';
import { jsonResponse } from '../lib/http';
import { now } from '../lib/clock';

interface SignBody {
  path: string | null;
  ttl: string | null;
}

/** A `type`, not an interface: it goes to `jsonResponse`, and only an inferred
    object type carries the index signature `Serializable` asks for. */
type MintResponse = {
  url: string;
  exp: number;
  tier: Tier;
  note?: string;
  openUrl?: string;
};

function decodeSignBody(text: string): SignBody | null {
  const record = parseObject(text);
  if (!record) return null;
  return { path: textAt(record, 'path'), ttl: textAt(record, 'ttl') };
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
  const gate = await authorize(request, env, { need: 'vault', flavor: 'json', keys: 'required' });
  if (gate instanceof Response) return gate;

  const body = decodeSignBody(await request.text());
  if (!body) return jsonResponse({ error: 'expected JSON body {path, ttl?}' }, 400);
  const parsed = body.path && parseArtifactPath(body.path);
  if (!parsed) return jsonResponse({ error: 'path must be <space>/<hash>' }, 400);
  const [space, hash] = parsed;

  const t = now();
  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  const ttlSecs = body.ttl ? parseDuration(body.ttl) : DEFAULT_LINK_DAYS * 86400;
  if (ttlSecs === null) return jsonResponse({ error: 'bad ttl' }, 400);
  const exp = ttlSecs === 0 ? 0 : t + ttlSecs;

  const origin = new URL(request.url).origin;
  const link = await mintArtifactLink(gate.keys, origin, meta, exp);

  const out: MintResponse = { ...link, tier: meta.tier };
  if (meta.tier !== 'open') return jsonResponse(out);
  // A signed link to an open artifact works, but the plain URL is shorter.
  return jsonResponse({
    ...out,
    note: 'artifact is open tier; the unsigned URL also works',
    openUrl: publicUrl(origin, meta),
  });
}
