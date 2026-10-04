/**
 * The `notambourine-velocity` GitHub App, the same one ../site's velocity board
 * reads with: App JWT -> the installation that covers a repo -> a one-hour token.
 */

import { b64url } from '../lib/b64';
import type { Serializable } from '../lib/json';
import { numberAt, parseObject, textAt } from '../lib/json';

const API = 'https://api.github.com';
const AGENT = 'notambourine-share';

export interface AppCredentials {
  id: string;
  /** PKCS#8 PEM. Web Crypto cannot import the PKCS#1 key GitHub downloads. */
  key: string;
}

const enc = new TextEncoder();
const segment = (value: Serializable): string => b64url(enc.encode(JSON.stringify(value)));

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// Backdated a minute for clock skew; GitHub rejects a lifetime over ten minutes.
export async function appJwt(app: AppCredentials, t: number): Promise<string> {
  const unsigned = `${segment({ alg: 'RS256', typ: 'JWT' })}.${segment({ iat: t - 60, exp: t + 540, iss: app.id })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(app.key), enc.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

export function github(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': AGENT,
      ...init.headers,
    },
  });
}

/** One token per owner, minted through whichever installation covers `repo`;
    null when the App is not installed there. */
export async function installationToken(jwt: string, repo: string): Promise<string | null> {
  const found = await github(`/repos/${repo}/installation`, jwt);
  const id = found.ok ? numberAt(parseObject(await found.text()) ?? {}, 'id') : null;
  if (id === null) return null;
  const minted = await github(`/app/installations/${id}/access_tokens`, jwt, { method: 'POST' });
  return minted.ok ? textAt(parseObject(await minted.text()) ?? {}, 'token') : null;
}
