import { describe, expect, it } from 'vitest';
import { authenticate, authorize, requireKeys, sha256hex } from '../src/lib/auth';

function req(auth?: string): Request {
  return new Request('https://share.example/up/acme', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

const KEYS = { v1: 'unit-test-signing-secret' };

async function env(tokens: Record<string, string>) {
  const hashed: Record<string, string> = {};
  for (const [name, tok] of Object.entries(tokens)) hashed[name] = await sha256hex(tok);
  return { TOKENS: JSON.stringify(hashed), SIGNING_KEYS: JSON.stringify(KEYS) };
}

describe('authenticate', () => {
  it('maps a valid raw token to its uploader name', async () => {
    const e = await env({ tom: 'secret-token' });
    expect(await authenticate(req('Bearer secret-token'), e)).toBe('tom');
  });

  it('rejects wrong, missing, and malformed credentials', async () => {
    const e = await env({ tom: 'secret-token' });
    expect(await authenticate(req('Bearer wrong'), e)).toBeNull();
    expect(await authenticate(req(), e)).toBeNull();
    expect(await authenticate(req('Basic secret-token'), e)).toBeNull();
    expect(await authenticate(req('Bearer secret-token'), { TOKENS: 'not json', SIGNING_KEYS: '{}' })).toBeNull();
  });

  it('revoking one person is a map edit', async () => {
    const both = await env({ tom: 'tok-a', sam: 'tok-b' });
    const onlyTom = await env({ tom: 'tok-a' });
    expect(await authenticate(req('Bearer tok-b'), both)).toBe('sam');
    expect(await authenticate(req('Bearer tok-b'), onlyTom)).toBeNull();
  });
});

/* One credential kind reaches the gate now, so what is left to hold is the
   spelling of each refusal and the misconfigured-keys 500. */
describe('authorize', () => {
  const vaultEnv = () => env({ tom: 'secret-token' });

  function granted(result: { name: string; keys: unknown } | Response) {
    if (result instanceof Response) throw new Error(`refused with ${result.status}`);
    return result;
  }

  async function refusal(result: { name: string } | Response) {
    if (!(result instanceof Response)) throw new Error(`granted to ${result.name}`);
    return { status: result.status, type: result.headers.get('content-type'), body: await result.text() };
  }

  it('admits a vault token and hands back the keys it signs with', async () => {
    const g = granted(await authorize(req('Bearer secret-token'), await vaultEnv(), { flavor: 'json' }));
    expect(g.name).toBe('tom');
    expect(g.keys).toEqual(KEYS);
  });

  it('refuses garbage and a missing header with a blank unauthorized', async () => {
    for (const r of [req('Bearer wrong'), req(), req('Basic secret-token')]) {
      const out = await refusal(await authorize(r, await vaultEnv(), { flavor: 'json' }));
      expect(out.status).toBe(401);
      expect(out.body).toBe(`${JSON.stringify({ error: 'unauthorized' }, null, 2)}\n`);
    }
  });

  it('spells the refusal as text for the text callers', async () => {
    const r = await refusal(await authorize(req(), await vaultEnv(), { flavor: 'text' }));
    expect(r.type).toBe('text/plain; charset=utf-8');
    expect(r.body).toBe('unauthorized\n');
  });

  it('lets a route answer a stranger its own way', async () => {
    const hidden = () => new Response('nothing here', { status: 404 });
    const anon = await refusal(await authorize(req(), await vaultEnv(), { flavor: 'json', anonymous: hidden }));
    expect(anon.status).toBe(404);
  });

  describe('signing keys', () => {
    const broken = async () => ({ ...await vaultEnv(), SIGNING_KEYS: '{}' });

    it('500s a verb that must sign', async () => {
      const r = await refusal(await authorize(
        req('Bearer secret-token'), await broken(), { flavor: 'json', keys: 'required' },
      ));
      expect(r.status).toBe(500);
      expect(r.body).toBe(`${JSON.stringify({ error: 'signing keys misconfigured' }, null, 2)}\n`);
    });

    it('hands a verb that only signs when it can a null key set', async () => {
      const g = granted(await authorize(req('Bearer secret-token'), await broken(), { flavor: 'text' }));
      expect(g.keys).toBeNull();
    });

    it('answers the `?c=` routes with the same 500', async () => {
      expect(requireKeys({ SIGNING_KEYS: JSON.stringify(KEYS) }, 'json')).toEqual(KEYS);
      const r = requireKeys({ SIGNING_KEYS: '{}' }, 'json');
      if (!(r instanceof Response)) throw new Error('expected a refusal');
      expect(r.status).toBe(500);
      expect(await r.text()).toContain('signing keys misconfigured');
    });
  });
});
