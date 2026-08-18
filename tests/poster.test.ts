import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { serve } from '../src/routes/serve';
import { posterParent, posterPath } from '../src/lib/poster';
import { sha256hex } from '../src/lib/auth';
import type { TestEnv } from './bindings';
import { DEFERRED, testEnv } from './bindings';

const SPACE = 'acme';
const AUTH = 'Bearer raw-token';
const SLACK = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';

async function stubEnv(): Promise<TestEnv> {
  return testEnv({ tokens: JSON.stringify({ tom: await sha256hex('raw-token') }) });
}

/** `names` land as one upload, so a poster meets the parent it names. */
async function putFiles(env: Env, names: string[]) {
  const form = new FormData();
  for (const n of names) form.append('f', new Blob([`bytes of ${n}`]), n);
  const req = new Request(`https://share.test/up/${SPACE}`, {
    method: 'POST',
    headers: { authorization: AUTH, accept: 'application/json' },
    body: form,
  });
  const res = await upload(req, env, DEFERRED, SPACE);
  return res.json<{ hash: string; files: string[] }>();
}

const get = (env: Env, hash: string, rest: string, ua: string) => serve(
  new Request(`https://share.test/${SPACE}/${hash}/${rest}`, {
    headers: { accept: '*/*', 'user-agent': ua },
  }),
  env, DEFERRED, SPACE, hash, null, rest,
);

describe('poster naming', () => {
  it('round-trips, and a bare suffix names nobody', () => {
    expect(posterParent(posterPath('clip.mp4'))).toBe('clip.mp4');
    expect(posterParent('clip.mp4')).toBe(null);
    expect(posterParent('.poster.jpg')).toBe(null);
  });
});

describe('a poster rides with its parent', () => {
  it('never becomes a row of its own', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, ['clip.mp4', posterPath('clip.mp4')]);
    /* The whole point of folding it into the parent: the file count, the
       listing, and the single-file link all stay blind to it. */
    expect(made.files).toEqual(['clip.mp4']);
  });

  it('serves as bytes, so og:image resolves to a picture', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, ['clip.mp4', posterPath('clip.mp4')]);
    const res = await get(env, made.hash, posterPath('clip.mp4'), SLACK);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('an orphan keeps its own row rather than being swallowed', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, [posterPath('absent.mp4')]);
    expect(made.files).toEqual([posterPath('absent.mp4')]);
  });
});

describe('the unfurl card', () => {
  it('gives a crawler tags and the frame where curl gets video', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, ['clip.mp4', posterPath('clip.mp4')]);

    const bytes = await get(env, made.hash, 'clip.mp4', 'curl/8.7.1');
    expect(bytes.headers.get('content-type')).toBe('video/mp4');

    const card = await get(env, made.hash, 'clip.mp4', SLACK);
    const html = await card.text();
    expect(card.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<meta property="og:title" content="clip.mp4">');
    expect(html).toContain('content="summary_large_image"');
    expect(html).toContain(`og:image" content="https://share.test/${SPACE}/${made.hash}/${posterPath('clip.mp4')}?raw"`);
    // The human page paints the same frame instead of a black rectangle.
    expect(html).toContain('<video controls poster=');
  });

  it('falls back to a text card when no frame rode along', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, ['clip.mp4']);
    const html = await (await get(env, made.hash, 'clip.mp4', SLACK)).text();
    expect(html).toContain('content="summary"');
    expect(html).not.toContain('og:image');
  });

  /* One URL, three answers. Drop User-Agent from Vary and a cache can hand the
     crawler's HTML to an <img src>. */
  it('varies on both keys it actually reads', async () => {
    const env = await stubEnv();
    const made = await putFiles(env, ['clip.mp4']);
    for (const ua of ['curl/8.7.1', SLACK]) {
      const res = await get(env, made.hash, 'clip.mp4', ua);
      expect(res.headers.get('vary')).toBe('Accept, User-Agent');
    }
  });
});
