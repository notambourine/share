import { describe, expect, it } from 'vitest';
import { authorize, verifyAccessJwt } from '../src/lib/auth';
import { ACCESS, accessJwt } from './access';

const T = () => Math.floor(Date.now() / 1000);

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://share.example/up/acme', { method: 'POST', headers });
}

describe('verifyAccessJwt', () => {
  it('answers the email a good token names', async () => {
    expect(await verifyAccessJwt(await accessJwt(), ACCESS, T())).toBe('tom@notambourine.com');
  });

  it('takes aud as a bare string too', async () => {
    expect(await verifyAccessJwt(await accessJwt({ aud: ACCESS.ACCESS_AUD }), ACCESS, T())).toBe('tom@notambourine.com');
  });

  it('refuses another app, another team, an expired token, and an unknown key', async () => {
    expect(await verifyAccessJwt(await accessJwt({ aud: ['other-app'] }), ACCESS, T())).toBeNull();
    expect(await verifyAccessJwt(await accessJwt({ iss: 'https://evil.cloudflareaccess.com' }), ACCESS, T())).toBeNull();
    expect(await verifyAccessJwt(await accessJwt({ exp: T() - 1 }), ACCESS, T())).toBeNull();
    expect(await verifyAccessJwt(await accessJwt({}, 'rotated-away'), ACCESS, T())).toBeNull();
  });

  it('refuses a tampered payload and garbage', async () => {
    const [h, , s] = (await accessJwt()).split('.');
    const forged = (await accessJwt({ email: 'mallory@example.com' })).split('.')[1];
    expect(await verifyAccessJwt(`${h}.${forged}.${s}`, ACCESS, T())).toBeNull();
    expect(await verifyAccessJwt('not.a.jwt', ACCESS, T())).toBeNull();
    expect(await verifyAccessJwt('', ACCESS, T())).toBeNull();
  });
});

describe('authorize', () => {
  it('grants the Access identity', async () => {
    const g = await authorize(req({ 'cf-access-jwt-assertion': await accessJwt() }), ACCESS, 'json');
    expect(g).toEqual({ email: 'tom@notambourine.com' });
  });

  it('refuses a missing assertion in the route flavor', async () => {
    const text = await authorize(req(), ACCESS, 'text');
    if (!(text instanceof Response)) throw new Error('granted');
    expect(text.status).toBe(401);
    expect(await text.text()).toBe('unauthorized\n');
    const json = await authorize(req(), ACCESS, 'json');
    if (!(json instanceof Response)) throw new Error('granted');
    expect(await json.text()).toBe(`${JSON.stringify({ error: 'unauthorized' }, null, 2)}\n`);
  });

  /* The Access cookie rides on any same-site request, so a write from another
     origin is refused before the identity is even read. */
  it('refuses a cross-origin write even when signed in', async () => {
    const r = req({ 'cf-access-jwt-assertion': await accessJwt(), origin: 'https://evil.notambourine.com' });
    const out = await authorize(r, ACCESS, 'json');
    if (!(out instanceof Response)) throw new Error('granted');
    expect(out.status).toBe(403);
    const same = req({ 'cf-access-jwt-assertion': await accessJwt(), origin: 'https://share.example' });
    expect(await authorize(same, ACCESS, 'json')).toEqual({ email: 'tom@notambourine.com' });
  });
});
