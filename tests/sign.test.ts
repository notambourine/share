import { describe, expect, it } from 'vitest';
import { mintToken, verifyToken, mintKeyId, constantTimeEqual } from '../src/lib/sign';

const KEYS = { v1: 'test-secret-one', v2: 'test-secret-two' };
const PREFIX = 'acme/Ab3dEf6hIj9k';
const NOW = 1_800_000_000;

describe('mint and verify', () => {
  it('round-trips', async () => {
    const token = await mintToken(KEYS, PREFIX, NOW + 3600);
    expect(token).toMatch(/^v2\.\d+\.[A-Za-z0-9_-]{22}$/);
    expect((await verifyToken(KEYS, PREFIX, token, NOW)).ok).toBe(true);
  });

  it('mints with the highest key id, verifies older ids', async () => {
    expect(mintKeyId(KEYS)).toBe('v2');
    const old = await mintToken({ v1: KEYS.v1 }, PREFIX, NOW + 3600);
    expect(old.startsWith('v1.')).toBe(true);
    expect((await verifyToken(KEYS, PREFIX, old, NOW)).ok).toBe(true);
  });

  it('rejects a tampered exp', async () => {
    const token = await mintToken(KEYS, PREFIX, NOW + 60);
    const [id, , sig] = token.split('.');
    const forged = `${id}.${NOW + 9999999}.${sig}`;
    expect((await verifyToken(KEYS, PREFIX, forged, NOW))).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
  });

  it('rejects an expired token', async () => {
    const token = await mintToken(KEYS, PREFIX, NOW - 1);
    expect(await verifyToken(KEYS, PREFIX, token, NOW)).toMatchObject({
      ok: false, reason: 'expired',
    });
  });

  it('exp=0 means signed forever', async () => {
    const token = await mintToken(KEYS, PREFIX, 0);
    expect((await verifyToken(KEYS, PREFIX, token, NOW)).ok).toBe(true);
  });

  it('a token for one artifact opens nothing else', async () => {
    const token = await mintToken(KEYS, PREFIX, NOW + 3600);
    expect((await verifyToken(KEYS, 'acme/Zz9dEf6hIj9k', token, NOW)).ok).toBe(false); // gitleaks:allow
    expect((await verifyToken(KEYS, 'other/Ab3dEf6hIj9k', token, NOW)).ok).toBe(false);
  });

  it('rejects unknown key ids and malformed tokens', async () => {
    const token = await mintToken({ v9: 'future' }, PREFIX, NOW + 3600);
    expect(await verifyToken(KEYS, PREFIX, token, NOW)).toMatchObject({
      ok: false, reason: 'unknown-key',
    });
    for (const junk of ['', 'v1', 'v1.abc.def', 'v1.123.short', 'x'.repeat(200)]) {
      expect((await verifyToken(KEYS, PREFIX, junk, NOW)).ok).toBe(false);
    }
  });

  it('dropping a key kills its outstanding links', async () => {
    const token = await mintToken({ v1: KEYS.v1 }, PREFIX, 0);
    expect((await verifyToken({ v2: KEYS.v2 }, PREFIX, token, NOW)).ok).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('compares correctly', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});
