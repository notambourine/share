import { describe, expect, it } from 'vitest';
import { ADMIN_SECS, mintAdminToken, verifyAdminToken } from '../src/lib/admin';
import { mintToken, verifyToken } from '../src/lib/sign';
import { del } from '../src/routes/del';
import { serve } from '../src/routes/serve';
import type { TestEnv } from './bindings';
import { DEFERRED, testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const VIEW_PREFIX = `${SPACE}/${HASH}`;
const NOW = Math.floor(Date.now() / 1000);
const EXP = NOW + ADMIN_SECS;

function seededEnv(tier: 'open' | 'signed' = 'open'): TestEnv {
  const meta = JSON.stringify({
    space: SPACE, hash: HASH, tier, uploader: 'tom',
    createdAt: NOW, expiresAt: null, idleTtl: null, lastAccess: NOW,
    files: [{ path: 'deck.md', size: 6, type: 'text/markdown' }],
  });
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    objects: {
      [`${VIEW_PREFIX}/meta.json`]: meta,
      [`${VIEW_PREFIX}/f/deck.md`]: '# deck',
    },
  });
}

function delReq(c: string | null): Request {
  const query = c === null ? '' : `?c=${c}`;
  return new Request(`https://share.example/${SPACE}/${HASH}/${query}`, { method: 'DELETE' });
}

describe('admin token scope', () => {
  it('round-trips inside its window', async () => {
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await verifyAdminToken(KEYS, SPACE, HASH, token, NOW)).ok).toBe(true);
  });

  it('a view token fails the admin check', async () => {
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, view, NOW)).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
  });

  it('an admin token fails the view check', async () => {
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect(await verifyToken(KEYS, VIEW_PREFIX, admin, NOW)).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
  });

  it('admits nothing beyond its one artifact', async () => {
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await verifyAdminToken(KEYS, SPACE, 'Zz9dEf6hIj9k', admin, NOW)).ok).toBe(false); // gitleaks:allow
    expect((await verifyAdminToken(KEYS, 'other', HASH, admin, NOW)).ok).toBe(false);
  });

  it('expires, and exp=0 never verifies', async () => {
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, stale, NOW)).toMatchObject({
      ok: false, reason: 'expired',
    });
    const forever = await mintAdminToken(KEYS, SPACE, HASH, 0);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, forever, NOW)).toMatchObject({
      ok: false, reason: 'expired',
    });
  });
});

describe('DELETE with ?c=', () => {
  it('a live admin token soft-deletes, no bearer needed', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await del(delReq(token), env, SPACE, HASH);
    expect(res.status).toBe(204);
    expect(env.BUCKET.objects.has(`${VIEW_PREFIX}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`_trash/${VIEW_PREFIX}/meta.json`)).toBe(true);
  });

  it('a view token in c= is refused', async () => {
    const env = seededEnv();
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    const res = await del(delReq(view), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(env.BUCKET.objects.has(`${VIEW_PREFIX}/meta.json`)).toBe(true);
  });

  it('an expired admin token is refused', async () => {
    const env = seededEnv();
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect((await del(delReq(stale), env, SPACE, HASH)).status).toBe(401);
  });

  it("one artifact's admin token cannot delete another", async () => {
    const env = seededEnv();
    const other = await mintAdminToken(KEYS, SPACE, 'Zz9dEf6hIj9k', EXP); // gitleaks:allow
    expect((await del(delReq(other), env, SPACE, HASH)).status).toBe(401);
  });
});

describe('view routes with an admin token', () => {
  it('the /k/ slot refuses an admin token where a view token works', async () => {
    const env = seededEnv('signed');
    const req = new Request(`https://share.example/${SPACE}/${HASH}/deck.md`);
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await serve(req, env, DEFERRED, SPACE, HASH, admin, 'deck.md')).status).toBe(401);
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect((await serve(req, env, DEFERRED, SPACE, HASH, view, 'deck.md')).status).toBe(200);
  });
});
