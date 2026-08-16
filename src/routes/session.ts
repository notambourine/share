import type { Env } from '../lib/types';
import { authenticateRaw, mintSession, SESSION_DEFAULT_SECS, SESSION_MAX_SECS } from '../lib/auth';
import { parseDuration } from '../lib/keys';
import { parseSigningKeys } from '../lib/sign';
import { jsonResponse, now } from '../lib/http';

/**
 * POST /session: trade the raw vault token for a short-lived session token.
 * One 1Password unlock then covers a whole conversation of verbs, and the
 * 201 doubles as preflight: it proves the server accepts the vault token.
 * Raw Bearer only, so a session can never mint its own successor.
 */
export async function session(request: Request, env: Env): Promise<Response> {
  const name = await authenticateRaw(request, env.TOKENS);
  if (!name) return jsonResponse({ error: 'unauthorized' }, 401);

  let secs = SESSION_DEFAULT_SECS;
  const ttlParam = new URL(request.url).searchParams.get('ttl');
  if (ttlParam) {
    const parsed = parseDuration(ttlParam);
    if (!parsed || parsed > SESSION_MAX_SECS) {
      return jsonResponse({ error: 'ttl must be between 1m and 1h' }, 400);
    }
    secs = parsed;
  }

  const keys = parseSigningKeys(env);
  if (!keys) return jsonResponse({ error: 'signing keys misconfigured' }, 500);

  const expiresAt = now() + secs;
  const token = await mintSession(keys, name, expiresAt);
  return jsonResponse({ token, name, expiresAt }, 201);
}
