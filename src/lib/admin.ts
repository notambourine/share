/**
 * Admin tokens: `?c=v<n>.<exp>.<sig>.<origin>` at the artifact root, HMAC over
 * `admin:<space>/<hash>@<origin>|<exp>`. Same primitive as view tokens, different
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

/** The slide stops here. Each refresh is signed over the session's first mint,
    so a leaked link cannot renew itself past the hour; re-open mints anew. */
export const ADMIN_SESSION_SECS = 3600;

const scope = (space: string, hash: string, origin: number): string => `admin:${space}/${hash}@${origin}`;

/** `v<n>.<exp>.<sig>.<origin>`: the signed token, then the session's first mint
    epoch, which the signature covers through the scope. */
export async function mintAdminToken(
  keys: SigningKeys, space: string, hash: string, exp: number, origin = Math.max(0, exp - ADMIN_SECS),
): Promise<string> {
  return `${await mintToken(keys, scope(space, hash, origin), exp)}.${origin}`;
}

/** The exp a refresh at `t` may carry: a fresh window, cut at the session's end. */
export function refreshExp(t: number, origin: number): number {
  return Math.min(t + ADMIN_SECS, origin + ADMIN_SESSION_SECS);
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
  return { url: `${origin}/${space}/${hash}/?c=${await mintAdminToken(keys, space, hash, exp, t)}`, exp };
}

export interface AdminVerify extends VerifyResult {
  /** Epoch seconds the token carries; 0 when it verified as anything else.
      Answered here so the admin page never has to take a credential apart. */
  exp: number;
  /** The session's first mint, so a refresh can be cut at the session's end. */
  origin: number;
}

export async function verifyAdminToken(
  keys: SigningKeys, space: string, hash: string, token: string, now: number,
): Promise<AdminVerify> {
  const parts = token.split('.');
  const origin = Number(parts[3]);
  const bad = (reason: VerifyResult['reason']): AdminVerify => ({ ok: false, reason, exp: 0, origin: 0 });
  if (parts.length !== 4 || !/^\d+$/.test(parts[3])) return bad('malformed');
  const exp = Number(parts[1]);
  // exp=0 means "forever" in the link grammar; a write credential never does,
  // and none outlives the session it was first minted in.
  if (exp === 0 || exp > origin + ADMIN_SESSION_SECS) return bad('expired');
  const v = await verifyToken(keys, scope(space, hash, origin), parts.slice(0, 3).join('.'), now);
  return { ...v, exp: Number.isFinite(exp) ? exp : 0, origin };
}
