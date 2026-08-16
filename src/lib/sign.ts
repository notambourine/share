/**
 * Signed-tier tokens: a path segment `/k/v1.<exp>.<sig>/`.
 * sig = base64url(HMAC-SHA256(key_v1, "<space>/<hash>|<exp>")) truncated to 128 bits.
 * The signature covers the upload prefix, so one token admits every file inside it.
 *
 * A path segment, never `?k=`: relative URLs drop a query string, so a signed
 * index.html would 401 every ./style.css it loads. Same length either way.
 */

import { decodeTextMap } from './json';

const enc = new TextEncoder();

/** Key id ("v1") -> base64url secret. */
export type SigningKeys = Readonly<Record<string, string>>;

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
}

async function sig(secret: string, prefix: string, exp: number): Promise<string> {
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${prefix}|${exp}`));
  return b64url(new Uint8Array(mac).slice(0, 16));
}

export function parseSigningKeys(env: { SIGNING_KEYS: string }): SigningKeys | null {
  return decodeTextMap(env.SIGNING_KEYS);
}

/** Numerically-highest key id mints; older ids only verify, so links age out on rotation. */
export function mintKeyId(keys: SigningKeys): string {
  const ids = Object.keys(keys).filter((k) => /^v\d+$/.test(k));
  if (ids.length === 0) throw new Error('SIGNING_KEYS has no v<n> key');
  ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return ids[ids.length - 1];
}

/** exp is epoch seconds; 0 = no expiry, still signed. */
export async function mintToken(
  keys: SigningKeys, prefix: string, exp: number,
): Promise<string> {
  const id = mintKeyId(keys);
  return `${id}.${exp}.${await sig(keys[id], prefix, exp)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'malformed' | 'unknown-key' | 'bad-signature' | 'expired';
}

export async function verifyToken(
  keys: SigningKeys, prefix: string, token: string, now: number,
): Promise<VerifyResult> {
  const m = /^(v\d+)\.(\d+)\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return { ok: false, reason: 'malformed' };
  const [, id, expRaw, given] = m;
  const secret = keys[id];
  if (!secret) return { ok: false, reason: 'unknown-key' };
  const exp = Number(expRaw);
  const expect = await sig(secret, prefix, exp);
  if (!constantTimeEqual(expect, given)) return { ok: false, reason: 'bad-signature' };
  if (exp !== 0 && exp < now) return { ok: false, reason: 'expired' };
  return { ok: true };
}
