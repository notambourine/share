/** GET /<space>/ - the uploader's index, reached the way a caller reaches it. */

import { describe, expect, it } from 'vitest';
import { mintSession, sha256hex } from '../src/lib/auth';
import { now } from '../src/lib/clock';
import { fetchWorker, testEnv } from './bindings';
import type { TestEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const OLD = 'Ol1derAaaaaa';
const NEW = 'Ne2werBbbbbb';
const NOW = now();

interface Row {
  hash: string;
  url: string;
  expired: boolean;
  files: number;
  bytes: number;
  sources: string[];
}

function metaFor(hash: string, createdAt: number, expiresAt: number | null): string {
  return JSON.stringify({
    space: SPACE, hash, tier: 'open', uploader: 'tom',
    createdAt, expiresAt,
    files: [{ path: 'note.md', size: 6, type: 'text/markdown' }],
  });
}

async function seeded(): Promise<TestEnv> {
  return testEnv({
    tokens: JSON.stringify({ tom: await sha256hex('raw-token') }),
    signingKeys: JSON.stringify(KEYS),
    objects: {
      [`${SPACE}/${OLD}/meta.json`]: metaFor(OLD, NOW - 86400, NOW - 60),
      [`${SPACE}/${NEW}/meta.json`]: metaFor(NEW, NOW, NOW + 86400),
      // Another space's rows must not ride along.
      [`other/${NEW}/meta.json`]: metaFor(NEW, NOW, null),
    },
  });
}

const list = async (env: TestEnv, auth?: string) => fetchWorker(
  env,
  new Request(`https://share.test/${SPACE}/`, auth ? { headers: { authorization: auth } } : {}),
);

describe('GET /<space>/', () => {
  it('lists the space newest first, with the expiry verdict already taken', async () => {
    const res = await list(await seeded(), 'Bearer raw-token');
    expect(res.status).toBe(200);
    const rows = await res.json<Row[]>();
    expect(rows.map((r) => r.hash)).toEqual([NEW, OLD]);
    expect(rows.map((r) => r.expired)).toEqual([false, true]);
    expect(rows[0]).toMatchObject({
      url: `https://share.test/${SPACE}/${NEW}/note.md`,
      files: 1,
      bytes: 6,
    });
  });

  /* The paths that export something, so a caller can name every spelling
     without a request per artifact. The suffixes stay out of the answer: both
     ends read them off the export catalog, so listing them here would be a
     copy that goes stale the first time a format is added. */
  it('names the renderable sources and leaves the rest out', async () => {
    const env = testEnv({
      tokens: JSON.stringify({ tom: await sha256hex('raw-token') }),
      objects: {
        [`${SPACE}/${NEW}/meta.json`]: JSON.stringify({
          space: SPACE, hash: NEW, tier: 'open', uploader: 'tom',
          createdAt: NOW, expiresAt: null,
          files: [
            { path: 'deck.md', size: 6, type: 'text/markdown' },
            { path: 'chart.png', size: 9, type: 'image/png' },
          ],
        }),
      },
    });
    const rows = await (await list(env, 'Bearer raw-token')).json<Row[]>();
    expect(rows[0].sources).toEqual(['deck.md']);
    expect(rows[0].files).toBe(2);
  });

  /* Anonymous gets the same 404 as a missing page, so a space never confirms
     its own existence. */
  it('404s a stranger rather than admitting the space is there', async () => {
    const env = await seeded();
    expect((await list(env)).status).toBe(404);
    expect((await list(env, 'Bearer wrong-token')).status).toBe(404);
  });

  /* A session in an exfilled transcript must not be able to enumerate; the
     signature proves an insider, so naming the scope leaks nothing. */
  it('refuses a session token and names the vault token', async () => {
    const env = await seeded();
    const res = await list(env, `Bearer ${await mintSession(KEYS, 'tom', NOW + 300)}`);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('only authorizes /up');
  });

  it('answers an empty space with an empty list', async () => {
    const env = testEnv({ tokens: JSON.stringify({ tom: await sha256hex('raw-token') }) });
    const res = await list(env, 'Bearer raw-token');
    expect(res.status).toBe(200);
    expect(await res.json<Row[]>()).toEqual([]);
  });
});
