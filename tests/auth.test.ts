import { describe, expect, it } from 'vitest';
import { authenticate, authenticateRaw, mintSession, sha256hex } from '../src/lib/auth';
import { parseArtifactPath } from '../src/routes/mint';
import { now } from '../src/lib/http';

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
  const future = now() + 600;
  const past = now() - 600;

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
