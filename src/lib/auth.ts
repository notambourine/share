import { constantTimeEqual } from './sign';

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `Authorization: Bearer <token>` against a JSON map of name -> sha256 hex.
 * Returns the uploader name, or null. Revoking one person is a secret edit.
 */
export async function authenticate(
  request: Request, tokensJson: string,
): Promise<string | null> {
  const h = request.headers.get('authorization');
  const m = h && /^Bearer\s+(\S+)$/.exec(h);
  if (!m) return null;
  const digest = await sha256hex(m[1]);
  let map: Record<string, string>;
  try {
    map = JSON.parse(tokensJson);
  } catch {
    return null;
  }
  for (const [name, hash] of Object.entries(map)) {
    if (typeof hash === 'string' && constantTimeEqual(hash.toLowerCase(), digest)) return name;
  }
  return null;
}
