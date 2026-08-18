/** The nightly cron destroys nothing it cannot name, so what it walks and what
    it skips is the whole test. */

import { describe, expect, it } from 'vitest';
import { sweep } from '../src/sweep';
import { now } from '../src/lib/http';
import { scheduledWorker, testEnv } from './bindings';
import type { TestEnv } from './bindings';

const NOW = now();
const DEAD = 'Ex1piredAaaa';
const LIVE = 'St1llHereBbb';
const GONE = 'Al3adyTrashd';

function metaFor(space: string, hash: string, expiresAt: number | null): string {
  return JSON.stringify({
    space, hash, tier: 'open', uploader: 'tom',
    createdAt: NOW - 86400, expiresAt,
    files: [{ path: 'note.md', size: 6, type: 'text/markdown' }],
  });
}

function seeded(): TestEnv {
  return testEnv({
    objects: {
      [`acme/${DEAD}/meta.json`]: metaFor('acme', DEAD, NOW - 60),
      [`acme/${DEAD}/f/note.md`]: '# dead',
      [`acme/${LIVE}/meta.json`]: metaFor('acme', LIVE, NOW + 86400),
      [`acme/${LIVE}/f/note.md`]: '# live',
      // Already swept once. Walking it again would copy _trash/ into itself.
      [`_trash/acme/${GONE}/meta.json`]: metaFor('acme', GONE, NOW - 60),
    },
  });
}

describe('sweep', () => {
  it('trashes what expired, keeps what has not, and never walks _trash/', async () => {
    const env = seeded();
    expect(await sweep(env)).toEqual({ scanned: 2, trashed: 1 });

    expect(env.BUCKET.objects.has(`acme/${DEAD}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`acme/${DEAD}/f/note.md`)).toBe(false);
    // Soft delete: the upload token hides material, the lifecycle rule purges it.
    expect(env.BUCKET.objects.get(`_trash/acme/${DEAD}/f/note.md`)).toBe('# dead');

    expect(env.BUCKET.objects.has(`acme/${LIVE}/meta.json`)).toBe(true);
    expect(env.BUCKET.objects.has(`_trash/_trash/acme/${GONE}/meta.json`)).toBe(false);
  });

  it('an undecodable record is scanned and left alone, never trashed blind', async () => {
    const env = testEnv({ objects: { [`acme/${DEAD}/meta.json`]: 'not json' } });
    expect(await sweep(env)).toEqual({ scanned: 1, trashed: 0 });
    expect(env.BUCKET.objects.has(`acme/${DEAD}/meta.json`)).toBe(true);
  });

  it('runs off the cron handler, which defers it', async () => {
    const env = seeded();
    await scheduledWorker(env);
    expect(env.BUCKET.objects.has(`acme/${DEAD}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`acme/${LIVE}/meta.json`)).toBe(true);
  });
});
