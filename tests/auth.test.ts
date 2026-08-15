import { describe, expect, it } from 'vitest';
import { authenticate, sha256hex } from '../src/lib/auth';
import { parseArtifactPath } from '../src/routes/mint';

function req(auth?: string): Request {
  return new Request('https://share.example/up/acme', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

describe('authenticate', () => {
  it('maps a valid token to its uploader name', async () => {
    const tokens = JSON.stringify({ tom: await sha256hex('secret-token') });
    expect(await authenticate(req('Bearer secret-token'), tokens)).toBe('tom');
  });

  it('rejects wrong, missing, and malformed credentials', async () => {
    const tokens = JSON.stringify({ tom: await sha256hex('secret-token') });
    expect(await authenticate(req('Bearer wrong'), tokens)).toBeNull();
    expect(await authenticate(req(), tokens)).toBeNull();
    expect(await authenticate(req('Basic secret-token'), tokens)).toBeNull();
    expect(await authenticate(req('Bearer secret-token'), 'not json')).toBeNull();
  });

  it('revoking one person is a map edit', async () => {
    const both = JSON.stringify({
      tom: await sha256hex('tok-a'),
      sam: await sha256hex('tok-b'),
    });
    const onlyTom = JSON.stringify({ tom: await sha256hex('tok-a') });
    expect(await authenticate(req('Bearer tok-b'), both)).toBe('sam');
    expect(await authenticate(req('Bearer tok-b'), onlyTom)).toBeNull();
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
