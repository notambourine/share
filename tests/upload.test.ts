import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { adminConfig } from '../src/routes/admin';
import { fetchWorker, testEnv } from './bindings';
import { signedIn } from './access';

const SPACE = 'acme';

async function put(
  env: Env, auth: Record<string, string>, query = '', accept = 'application/json', name = 'note.md',
) {
  const form = new FormData();
  form.append('f', new Blob(['# hello\n']), name);
  const req = new Request(`https://share.test/up/${SPACE}${query}`, {
    method: 'POST', headers: { ...auth, accept }, body: form,
  });
  return upload(req, env, SPACE);
}

describe('one upload, one URL', () => {
  it('answers the public URL and serves it', async () => {
    const env = testEnv();
    const res = await put(env, await signedIn());
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; hash: string; files: string[] }>();
    expect(body.files).toEqual(['note.md']);
    expect(body.url).toBe(`https://share.test/${SPACE}/${body.hash}/note.md`);

    const view = await fetchWorker(env, new Request(body.url, { headers: { accept: '*/*' } }));
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('hello');
  });

  /* The tier is gone, so a param nobody ships is simply ignored rather than
     answering a second URL nobody can use. */
  it('mints no second link and takes no tier', async () => {
    const env = testEnv();
    const body = await (await put(env, await signedIn(), '?tier=signed'))
      .json<{ url: string; signedUrl?: string }>();
    expect(body.signedUrl).toBeUndefined();
    expect(body.url).not.toContain('/k/');
  });

  it('rejects a bad ttl before a byte lands', async () => {
    const env = testEnv();
    expect((await put(env, await signedIn(), '?ttl=nope')).status).toBe(400);
    expect(env.BUCKET.objects.size).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    expect((await put(testEnv(), {})).status).toBe(401);
  });

  /* Uploaded HTML would run on this origin beside the Access cookie, so it is
     refused at the door rather than served inert. */
  it('refuses html before a byte lands', async () => {
    const env = testEnv();
    for (const name of ['page.html', 'page.htm']) {
      const res = await put(env, await signedIn(), '', 'application/json', name);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(`not an allowed file type: ${name}`);
    }
    expect(env.BUCKET.objects.size).toBe(0);
  });
});

describe('put answers the working-page link', () => {
  it('points at the Access-guarded working page', async () => {
    const env = testEnv();
    const res = await put(env, await signedIn());
    const body = await res.json<{ hash: string; adminUrl: string; adminExp?: number }>();
    expect(body.adminUrl).toBe(`https://share.test/admin/${SPACE}/${body.hash}/`);
    expect(body.adminExp).toBeUndefined();

    // Works, not just parses: the same sign-in authorizes the config write.
    const write = await adminConfig(new Request(
      `${body.adminUrl}config`,
      { method: 'POST', headers: await signedIn(), body: JSON.stringify({ ttl: '7d' }) },
    ), env, SPACE, body.hash);
    expect(write.status).toBe(200);
  });

  it('the plain-text answer stays the one hand-over URL', async () => {
    const env = testEnv();
    const res = await put(env, await signedIn(), '', 'text/plain');
    const printed = (await res.text()).trim();
    expect(printed).not.toContain('/admin/');
    expect(printed.split('\n')).toHaveLength(1);
  });
});
