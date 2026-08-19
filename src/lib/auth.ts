import type { SigningKeys } from './sign';
import { constantTimeEqual, mintToken, parseSigningKeys, verifyToken } from './sign';
import { decodeTextMap } from './json';
import { jsonResponse, textResponse } from './http';
import { now } from './clock';

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Session tokens: `<name>.v<n>.<exp>.<sig>`, HMAC over `session:<name>|<exp>`.
    Raw tokens are dot-free base64, so the shape alone routes verification. */
const SESSION_RE = /^([a-z0-9-]{1,32})\.(v\d+\.\d+\.[A-Za-z0-9_-]{22})$/;

export const SESSION_DEFAULT_SECS = 300;
export const SESSION_MAX_SECS = 3600;

export async function mintSession(
  keys: SigningKeys, name: string, exp: number,
): Promise<string> {
  return `${name}.${await mintToken(keys, `session:${name}`, exp)}`;
}

/**
 * `Authorization: Bearer <token>` against a JSON map of name -> sha256 hex.
 * Raw vault tokens only; a session token cannot mint or extend a session.
 * Returns the uploader name, or null. Revoking one person is a secret edit.
 */
export async function authenticateRaw(
  request: Request, tokensJson: string,
): Promise<string | null> {
  const h = request.headers.get('authorization');
  const m = h && /^Bearer\s+(\S+)$/.exec(h);
  if (!m) return null;
  const digest = await sha256hex(m[1]);
  const map = decodeTextMap(tokensJson);
  if (!map) return null;
  for (const [name, hash] of Object.entries(map)) {
    if (constantTimeEqual(hash.toLowerCase(), digest)) return name;
  }
  return null;
}

/** The secrets auth reads, so a test builds one without the storage bindings. */
export interface AuthEnv {
  TOKENS: string;
  SIGNING_KEYS: string;
}

export interface AuthResult {
  name: string | null;
  /** Authenticated by a session token. Only /up honors these: a session in an
      exfilled transcript or env must not be able to list, delete, or sign an
      artifact it did not just create. */
  session?: boolean;
  /** A well-signed session failed only on time. Say so in the 401: the caller
      should mint a new session, not walk the token-drift runbook. */
  expired?: boolean;
}

/**
 * Bearer auth for the uploader verbs: a raw vault token or a session token.
 * A session that fails verification still falls through to the raw map, so a
 * raw token that happens to match the session shape keeps working. Routes go
 * through `authorize` below; this answers who, never whether.
 */
export async function authenticate(
  request: Request, env: AuthEnv,
): Promise<AuthResult> {
  const h = request.headers.get('authorization');
  const m = h && /^Bearer\s+(\S+)$/.exec(h);
  if (!m) return { name: null };
  let expired = false;
  const sess = SESSION_RE.exec(m[1]);
  if (sess) {
    const [, name, token] = sess;
    const keys = parseSigningKeys(env); // null falls through to the raw map
    if (keys) {
      const v = await verifyToken(keys, `session:${name}`, token, now());
      // exp=0 means "forever" in the link grammar; a session must always expire.
      if (v.ok && token.split('.')[1] !== '0') return { name, session: true };
      expired = v.reason === 'expired';
    }
  }
  const name = await authenticateRaw(request, env.TOKENS);
  return name ? { name } : { name: null, expired };
}

/** The wire contract for the CLI's re-mint: bin/share.ts retries a 401 whose
    body carries this phrase, so both ends read it from the one declaration. */
export const SESSION_EXPIRED_PHRASE = 'session expired';

/* Bare, with no trailing newline: the newline is the text spelling's, and the
   gate below is the only thing that knows which spelling a route speaks. */
const SESSION_EXPIRED_MSG = `unauthorized: ${SESSION_EXPIRED_PHRASE}; POST /session to mint a new one`;
const SESSION_SCOPE_MSG = 'unauthorized: a session token only authorizes /up; run this verb with the vault token';
const KEYS_MSG = 'signing keys misconfigured';

/** How a route speaks, so its refusals read like its answers. */
type Flavor = 'json' | 'text';

export interface Gate {
  /** `upload` admits a vault token or a live session; `vault` refuses a session,
      live or expired, so an exfilled session is capped at /up. */
  need: 'upload' | 'vault';
  flavor: Flavor;
  /** Routes that must sign refuse a misconfigured `SIGNING_KEYS` with a 500. */
  keys?: 'required';
  /** A route that hides its subject from strangers answers a missing credential
      its own way; the refusals that a signature proved still come from here. */
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
 * The one Bearer gate: who is calling, whether this verb takes their credential,
 * and the keys the verb signs with. A route either has a `Grant` or has its
 * refusal already written, so the session-scope rule lives here alone.
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
  const auth = await authenticate(request, env);
  // A live-or-expired session proved itself with a valid signature, so naming
  // the scope leaks nothing; a stranger still gets the route's blank refusal.
  if (gate.need === 'vault' && (auth.session || auth.expired)) {
    return refuse(gate.flavor, SESSION_SCOPE_MSG, 401);
  }
  if (!auth.name) {
    if (gate.anonymous) return gate.anonymous();
    return refuse(gate.flavor, auth.expired ? SESSION_EXPIRED_MSG : 'unauthorized', 401);
  }
  const keys = parseSigningKeys(env);
  if (!keys && gate.keys === 'required') return refuse(gate.flavor, KEYS_MSG, 500);
  return { name: auth.name, keys };
}

/** The same 500, for the `?c=` routes that sign without a Bearer. */
export function requireKeys(env: { SIGNING_KEYS: string }, flavor: Flavor): SigningKeys | Response {
  return parseSigningKeys(env) ?? refuse(flavor, KEYS_MSG, 500);
}
