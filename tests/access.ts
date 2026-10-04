/**
 * A stand-in Cloudflare Access: one RSA key, served at the team's certs URL,
 * signing whatever claims a test asks for. Importing this installs the certs
 * route on `fetch` and passes every other URL through.
 */

import type { AuthEnv } from '../src/lib/auth';
import { b64url } from '../src/lib/b64';
import type { Serializable } from '../src/lib/json';

export const ACCESS: AuthEnv = {
  ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com',
  ACCESS_AUD: 'test-aud',
};

const KID = 'test-kid';
const CERTS = `https://${ACCESS.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

function isPair(key: CryptoKey | CryptoKeyPair): key is CryptoKeyPair {
  return 'privateKey' in key;
}

const generated = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
if (!isPair(generated)) throw new Error('RSA generateKey answered a single key');
const pair = generated;
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

const passthrough = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === CERTS) return Response.json({ keys: [{ ...jwk, kid: KID }] });
  return passthrough(input, init);
};

const enc = new TextEncoder();
const segment = (value: Serializable): string => b64url(enc.encode(JSON.stringify(value)));

export interface Claims {
  [key: string]: Serializable;
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
}

export async function accessJwt(claims: Claims = {}, kid = KID): Promise<string> {
  const body = {
    email: 'tom@notambourine.com',
    aud: [ACCESS.ACCESS_AUD],
    iss: `https://${ACCESS.ACCESS_TEAM_DOMAIN}`,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  };
  const unsigned = `${segment({ alg: 'RS256', kid, typ: 'JWT' })}.${segment(body)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

/** The header Access adds to a request it let through. */
export async function signedIn(claims: Claims = {}): Promise<Record<string, string>> {
  return { 'cf-access-jwt-assertion': await accessJwt(claims) };
}
