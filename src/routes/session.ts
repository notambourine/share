import type { Env } from '../lib/types';
import { authorize, mintSession, SESSION_DEFAULT_SECS, SESSION_MAX_SECS } from '../lib/auth';
import { parseDuration } from '../lib/keys';
import { jsonResponse } from '../lib/http';
import { now } from '../lib/clock';

/**
 * POST /session: trade the raw vault token for a short-lived session token.
 * One 1Password unlock then covers a whole conversation of verbs, and the
 * 201 doubles as preflight: it proves the server accepts the vault token.
 * Vault token only, so a session can never mint its own successor.
 */
export async function session(request: Request, env: Env): Promise<Response> {
  const gate = await authorize(request, env, { need: 'vault', flavor: 'json', keys: 'required' });
  if (gate instanceof Response) return gate;

  let secs = SESSION_DEFAULT_SECS;
  const ttlParam = new URL(request.url).searchParams.get('ttl');
  if (ttlParam) {
    const parsed = parseDuration(ttlParam);
    if (!parsed || parsed > SESSION_MAX_SECS) {
      return jsonResponse({ error: 'ttl must be between 1m and 1h' }, 400);
    }
    secs = parsed;
  }

  const expiresAt = now() + secs;
  const token = await mintSession(gate.keys, gate.name, expiresAt);
  return jsonResponse({ token, name: gate.name, expiresAt }, 201);
}
