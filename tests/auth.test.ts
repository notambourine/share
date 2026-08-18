import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  authenticate, authenticateRaw, authorize, mintSession, requireKeys,
  SESSION_EXPIRED_PHRASE, sha256hex,
} from '../src/lib/auth';
import { parseArtifactPath } from '../src/routes/mint';

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
  it('maps a valid raw token to its uploader name, not marked as a session', async () => {
    const e = await env({ tom: 'secret-token' });
    const a = await authenticate(req('Bearer secret-token'), e);
    expect(a.name).toBe('tom');
    expect(a.session).toBeUndefined();
  });

  it('rejects wrong, missing, and malformed credentials', async () => {
    const e = await env({ tom: 'secret-token' });
    expect((await authenticate(req('Bearer wrong'), e)).name).toBeNull();
    expect((await authenticate(req(), e)).name).toBeNull();
    expect((await authenticate(req('Basic secret-token'), e)).name).toBeNull();
    expect((await authenticate(req('Bearer secret-token'), { TOKENS: 'not json', SIGNING_KEYS: '{}' })).name).toBeNull();
  });

  it('revoking one person is a map edit', async () => {
    const both = await env({ tom: 'tok-a', sam: 'tok-b' });
    const onlyTom = await env({ tom: 'tok-a' });
    expect((await authenticate(req('Bearer tok-b'), both)).name).toBe('sam');
    expect((await authenticate(req('Bearer tok-b'), onlyTom)).name).toBeNull();
  });
});

describe('session tokens', () => {
  const future = Math.floor(Date.now() / 1000) + 600;
  const past = Math.floor(Date.now() / 1000) - 600;

  it('a live session authenticates as its owner and is marked session', async () => {
    const e = await env({});
    const tok = await mintSession(KEYS, 'tom', future);
    const a = await authenticate(req(`Bearer ${tok}`), e);
    expect(a.name).toBe('tom');
    expect(a.session).toBe(true);
  });

  it('an expired session is rejected but named as expired', async () => {
    const e = await env({});
    const a = await authenticate(req(`Bearer ${await mintSession(KEYS, 'tom', past)}`), e);
    expect(a.name).toBeNull();
    expect(a.expired).toBe(true);
  });

  it('rejects renamed and never-expiring sessions without the expired flag', async () => {
    const e = await env({});
    const renamed = (await mintSession(KEYS, 'tom', future)).replace(/^tom\./, 'sam.');
    const a = await authenticate(req(`Bearer ${renamed}`), e);
    expect(a.name).toBeNull();
    expect(a.expired).toBeFalsy();
    expect((await authenticate(req(`Bearer ${await mintSession(KEYS, 'tom', 0)}`), e)).name).toBeNull();
  });

  it('a session token never passes the raw map', async () => {
    const e = await env({ tom: 'tok-a' });
    const tok = await mintSession(KEYS, 'tom', future);
    expect(await authenticateRaw(req(`Bearer ${tok}`), e.TOKENS)).toBeNull();
  });

  it('a raw token that looks like a session still reaches the map', async () => {
    const sessionLike = 'tom.v1.99.aaaaaaaaaaaaaaaaaaaaaa';
    const e = await env({ tom: sessionLike });
    expect((await authenticate(req(`Bearer ${sessionLike}`), e)).name).toBe('tom');
  });
});

/* The scope rule has one home now, so it gets one table: every need against
   every credential state, asserting the status and the body byte for byte. */
describe('authorize', () => {
  const future = Math.floor(Date.now() / 1000) + 600;
  const past = Math.floor(Date.now() / 1000) - 600;
  const SCOPE = 'unauthorized: a session token only authorizes /up; run this verb with the vault token';
  const EXPIRED = 'unauthorized: session expired; POST /session to mint a new one';

  const vaultEnv = () => env({ tom: 'secret-token' });
  const session = async (exp: number) => `Bearer ${await mintSession(KEYS, 'tom', exp)}`;

  function granted(result: { name: string; keys: unknown } | Response) {
    if (result instanceof Response) throw new Error(`refused with ${result.status}`);
    return result;
  }

  async function refusal(result: { name: string } | Response) {
    if (!(result instanceof Response)) throw new Error(`granted to ${result.name}`);
    return { status: result.status, type: result.headers.get('content-type'), body: await result.text() };
  }

  describe("need 'vault'", () => {
    const gate = { need: 'vault', flavor: 'json' } as const;

    it('admits a vault token and hands back the keys it signs with', async () => {
      const g = granted(await authorize(req('Bearer secret-token'), await vaultEnv(), gate));
      expect(g.name).toBe('tom');
      expect(g.keys).toEqual(KEYS);
    });

    it('refuses a live session with the scope message', async () => {
      const r = await refusal(await authorize(req(await session(future)), await vaultEnv(), gate));
      expect(r.status).toBe(401);
      expect(r.type).toBe('application/json; charset=utf-8');
      expect(r.body).toBe(`${JSON.stringify({ error: SCOPE }, null, 2)}\n`);
    });

    it('refuses an expired session with the scope message, not the expiry one', async () => {
      const r = await refusal(await authorize(req(await session(past)), await vaultEnv(), gate));
      expect(r.status).toBe(401);
      expect(r.body).toContain(SCOPE);
      expect(r.body).not.toContain(SESSION_EXPIRED_PHRASE);
    });

    it('refuses garbage and a missing header with a blank unauthorized', async () => {
      for (const r of [req('Bearer wrong'), req(), req('Basic secret-token')]) {
        const out = await refusal(await authorize(r, await vaultEnv(), gate));
        expect(out.status).toBe(401);
        expect(out.body).toBe(`${JSON.stringify({ error: 'unauthorized' }, null, 2)}\n`);
      }
    });

    it('spells the scope refusal as text for the text callers', async () => {
      const r = await refusal(await authorize(
        req(await session(future)), await vaultEnv(), { need: 'vault', flavor: 'text' },
      ));
      expect(r.status).toBe(401);
      expect(r.type).toBe('text/plain; charset=utf-8');
      expect(r.body).toBe(`${SCOPE}\n`);
    });

    it('lets a route answer a stranger its own way, and only a stranger', async () => {
      const hidden = () => new Response('nothing here', { status: 404 });
      const anon = await refusal(await authorize(req(), await vaultEnv(), { ...gate, anonymous: hidden }));
      expect(anon.status).toBe(404);
      const sess = await refusal(await authorize(req(await session(future)), await vaultEnv(), { ...gate, anonymous: hidden }));
      expect(sess.status).toBe(401);
      expect(sess.body).toContain(SCOPE);
    });
  });

  describe("need 'upload'", () => {
    const gate = { need: 'upload', flavor: 'text' } as const;

    it('admits a vault token and a live session alike', async () => {
      expect(granted(await authorize(req('Bearer secret-token'), await vaultEnv(), gate)).name).toBe('tom');
      expect(granted(await authorize(req(await session(future)), await vaultEnv(), gate)).name).toBe('tom');
    });

    it('names expiry as the reason, so the caller re-mints instead of debugging', async () => {
      const r = await refusal(await authorize(req(await session(past)), await vaultEnv(), gate));
      expect(r.status).toBe(401);
      expect(r.body).toBe(`${EXPIRED}\n`);
    });

    it('refuses garbage with a blank unauthorized', async () => {
      const r = await refusal(await authorize(req('Bearer wrong'), await vaultEnv(), gate));
      expect(r.status).toBe(401);
      expect(r.body).toBe('unauthorized\n');
    });
  });

  describe('signing keys', () => {
    const broken = async () => ({ ...await vaultEnv(), SIGNING_KEYS: '{}' });

    it('500s a verb that must sign', async () => {
      const r = await refusal(await authorize(
        req('Bearer secret-token'), await broken(), { need: 'vault', flavor: 'json', keys: 'required' },
      ));
      expect(r.status).toBe(500);
      expect(r.body).toBe(`${JSON.stringify({ error: 'signing keys misconfigured' }, null, 2)}\n`);
    });

    it('hands a verb that only signs when it can a null key set', async () => {
      const g = granted(await authorize(req('Bearer secret-token'), await broken(), { need: 'upload', flavor: 'text' }));
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

  /* The CLI re-mints its session off this phrase in the 401 body. It cannot
     import the constant: bin/ resolves node16 and src/ imports carry no
     extensions, so the two literals are pinned here instead. */
  it('keeps the phrase the CLI retries on', () => {
    expect(readFileSync('bin/share.ts', 'utf8')).toContain(`includes('${SESSION_EXPIRED_PHRASE}')`);
    expect(EXPIRED).toContain(SESSION_EXPIRED_PHRASE);
  });
});

describe('parseArtifactPath', () => {
  it('accepts bare, slashed, and full-URL forms', () => {
    expect(parseArtifactPath('acme/Ab3dEf6hIj9k')).toEqual(['acme', 'Ab3dEf6hIj9k']);
    expect(parseArtifactPath('/acme/Ab3dEf6hIj9k/')).toEqual(['acme', 'Ab3dEf6hIj9k']);
    expect(parseArtifactPath('https://share.example/acme/Ab3dEf6hIj9k/report.png'))
      .toEqual(['acme', 'Ab3dEf6hIj9k']);
  });
  it('rejects junk', () => {
    expect(parseArtifactPath('acme')).toBeNull();
    expect(parseArtifactPath('acme/short')).toBeNull();
    expect(parseArtifactPath('UP/Ab3dEf6hIj9k')).toBeNull();
  });
});
