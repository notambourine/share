import type { JsonObject } from './json';
import { numberAt, parseObject, recordsAt, textAt, textsAt } from './json';
import { jsonResponse, textResponse } from './http';
import { now } from './clock';
import { fromB64url } from './b64';

/** The Access application this Worker trusts. Plain vars: an AUD tag and a team
    domain identify the app, they do not unlock it. */
export interface AuthEnv {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const dec = new TextDecoder();

function decodeSegment(s: string): JsonObject | null {
  try {
    return parseObject(dec.decode(fromB64url(s)));
  } catch {
    return null;
  }
}

/* Keyed by team domain and kept for the isolate's life; a kid it has never seen
   refetches once, which is what picks up an Access key rotation. */
const certCache = new Map<string, Map<string, CryptoKey>>();

async function fetchCerts(team: string): Promise<Map<string, CryptoKey>> {
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  const body = res.ok ? parseObject(await res.text()) : null;
  const keys = new Map<string, CryptoKey>();
  for (const jwk of (body && recordsAt(body, 'keys')) ?? []) {
    const kid = textAt(jwk, 'kid');
    const n = textAt(jwk, 'n');
    const e = textAt(jwk, 'e');
    if (!kid || !n || !e) continue;
    keys.set(kid, await crypto.subtle.importKey(
      'jwk', { kty: 'RSA', n, e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    ));
  }
  certCache.set(team, keys);
  return keys;
}

async function certFor(team: string, kid: string): Promise<CryptoKey | null> {
  return certCache.get(team)?.get(kid) ?? (await fetchCerts(team)).get(kid) ?? null;
}

/** Access sends `aud` as an array; the spec also allows a bare string. */
function audiences(claims: JsonObject): string[] {
  const one = textAt(claims, 'aud');
  return one === null ? textsAt(claims, 'aud') : [one];
}

/**
 * The email an Access JWT names, or null. Access already checked it at the
 * edge; this check is what still holds on a route the edge never saw.
 */
export async function verifyAccessJwt(token: string, env: AuthEnv, t: number): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (!header || !claims || textAt(header, 'alg') !== 'RS256') return null;
  const kid = textAt(header, 'kid');
  const key = kid && await certFor(env.ACCESS_TEAM_DOMAIN, kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  if (textAt(claims, 'iss') !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  if (!audiences(claims).includes(env.ACCESS_AUD)) return null;
  const exp = numberAt(claims, 'exp');
  if (exp === null || exp < t) return null;
  return textAt(claims, 'email');
}

/** How a route speaks, so its refusals read like its answers. */
export type Flavor = 'json' | 'text';

function refuse(flavor: Flavor, message: string, status: number): Response {
  return flavor === 'json'
    ? jsonResponse({ error: message }, status)
    : textResponse(`${message}\n`, status);
}

/**
 * The one gate on every write: who Access says is calling. A browser write must
 * also come from this origin, because the Access cookie rides along on any
 * same-site request; the CLI sends no Origin at all.
 */
export async function authorize(
  request: Request, env: AuthEnv, flavor: Flavor,
): Promise<{ email: string } | Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return refuse(flavor, 'cross-origin write refused', 403);
  }
  const jwt = request.headers.get('cf-access-jwt-assertion');
  const email = jwt ? await verifyAccessJwt(jwt, env, now()) : null;
  return email ? { email } : refuse(flavor, 'unauthorized', 401);
}
