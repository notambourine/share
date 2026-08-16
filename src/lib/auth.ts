import type { SigningKeys } from './sign';
import { constantTimeEqual, mintToken, parseSigningKeys, verifyToken } from './sign';
import { decodeTextMap } from './json';
import { now } from './http';

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
 * raw token that happens to match the session shape keeps working.
 */
export async function authenticate(
  request: Request, env: { TOKENS: string; SIGNING_KEYS: string },
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

export const SESSION_EXPIRED_MSG = 'unauthorized: session expired; POST /session to mint a new one\n';
export const SESSION_SCOPE_MSG = 'unauthorized: a session token only authorizes /up; run this verb with the vault token\n';
