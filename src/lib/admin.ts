/**
 * Admin tokens: `?c=v<n>.<exp>.<sig>` at the artifact root, HMAC over
 * `admin:<space>/<hash>|<exp>`. Same primitive as view tokens, different
 * prefix, so each fails the other's verify on the signature rather than on a
 * check someone has to remember to write.
 *
 * A query param, unlike `/k/` (sign.ts explains that one): `c=` authorizes
 * only the config and delete routes, which the page calls with the token
 * attached, so it never has to survive a relative URL.
 */

import type { SigningKeys, VerifyResult } from './sign';
import { mintToken, verifyToken } from './sign';

/** Five minutes: this token writes, so its life is a blast-radius number.
    Sliding: each config write answers with a fresh token, never a longer exp. */
export const ADMIN_SECS = 300;

const scope = (space: string, hash: string): string => `admin:${space}/${hash}`;

export async function mintAdminToken(
  keys: SigningKeys, space: string, hash: string, exp: number,
): Promise<string> {
  return mintToken(keys, scope(space, hash), exp);
}

export interface AdminLink {
  url: string;
  /** Epoch seconds. */
  exp: number;
}

/** The full link, minted the same way at upload and on re-mint. */
export async function mintAdminLink(
  keys: SigningKeys, origin: string, space: string, hash: string, t: number,
): Promise<AdminLink> {
  const exp = t + ADMIN_SECS;
  return { url: `${origin}/${space}/${hash}/?c=${await mintAdminToken(keys, space, hash, exp)}`, exp };
}

export async function verifyAdminToken(
  keys: SigningKeys, space: string, hash: string, token: string, now: number,
): Promise<VerifyResult> {
  const v = await verifyToken(keys, scope(space, hash), token, now);
  // exp=0 means "forever" in the link grammar; a write credential never does.
  if (v.ok && token.split('.')[1] === '0') return { ok: false, reason: 'expired' };
  return v;
}
