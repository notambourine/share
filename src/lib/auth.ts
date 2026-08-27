import type { SigningKeys } from './sign';
import { constantTimeEqual, parseSigningKeys } from './sign';
import { decodeTextMap } from './json';
import { jsonResponse, textResponse } from './http';

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The secrets auth reads, so a test builds one without the storage bindings. */
export interface AuthEnv {
  TOKENS: string;
  SIGNING_KEYS: string;
}

/**
 * `Authorization: Bearer <token>` against a JSON map of name -> sha256 hex.
 * Answers who, never whether; routes go through `authorize` below. Revoking one
 * person is a secret edit.
 */
export async function authenticate(
  request: Request, env: AuthEnv,
): Promise<string | null> {
  const h = request.headers.get('authorization');
  const m = h && /^Bearer\s+(\S+)$/.exec(h);
  if (!m) return null;
  const digest = await sha256hex(m[1]);
  const map = decodeTextMap(env.TOKENS);
  if (!map) return null;
  for (const [name, hash] of Object.entries(map)) {
    if (constantTimeEqual(hash.toLowerCase(), digest)) return name;
  }
  return null;
}

const KEYS_MSG = 'signing keys misconfigured';

/** How a route speaks, so its refusals read like its answers. */
type Flavor = 'json' | 'text';

export interface Gate {
  flavor: Flavor;
  /** Routes that must sign refuse a misconfigured `SIGNING_KEYS` with a 500. */
  keys?: 'required';
  /** A route that hides its subject from strangers answers a missing credential
      its own way rather than admitting the path exists. */
  anonymous?: () => Response;
}

export interface Grant {
  name: string;
  keys: SigningKeys | null;
}

function refuse(flavor: Flavor, message: string, status: number): Response {
  return flavor === 'json'
    ? jsonResponse({ error: message }, status)
    : textResponse(`${message}\n`, status);
}

/**
 * The one Bearer gate: who is calling and the keys the verb signs with. One
 * credential kind reaches it - the vault token, which only ever mints - so what
 * is left here is the spelling of a refusal and the misconfigured-keys 500. A
 * route either has a `Grant` or has its refusal already written.
 */
export async function authorize(
  request: Request, env: AuthEnv, gate: Gate & { keys: 'required' },
): Promise<{ name: string; keys: SigningKeys } | Response>;
export async function authorize(
  request: Request, env: AuthEnv, gate: Gate,
): Promise<Grant | Response>;
export async function authorize(
  request: Request, env: AuthEnv, gate: Gate,
): Promise<Grant | Response> {
  const name = await authenticate(request, env);
  if (!name) {
    if (gate.anonymous) return gate.anonymous();
    return refuse(gate.flavor, 'unauthorized', 401);
  }
  const keys = parseSigningKeys(env);
  if (!keys && gate.keys === 'required') return refuse(gate.flavor, KEYS_MSG, 500);
  return { name, keys };
}

/** The same 500, for the `?c=` routes that sign without a Bearer. */
export function requireKeys(env: { SIGNING_KEYS: string }, flavor: Flavor): SigningKeys | Response {
  return parseSigningKeys(env) ?? refuse(flavor, KEYS_MSG, 500);
}
