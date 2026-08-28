import { describe, expect, it } from 'vitest';
import type { AiRunner } from '../src/lib/types';
import { readMeta } from '../src/lib/r2';
import { ADMIN_SECS, mintAdminToken } from '../src/lib/admin';
import { now } from '../src/lib/clock';
import { GENERATIONS, MAX_TRANSFORM_BYTES, promptFor } from '../src/transforms';
import { MODEL, SYSTEM, buildInput, cleanOutput, decodeAiText } from '../src/transforms/prompt';
import type { TestEnv } from './bindings';
import { fetchWorker, memoryAi, testEnv } from './bindings';
import { MAX_VERSIONS } from '../src/routes/generate';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const NOW = now();
const RAW = 'q3 sync thursday\n- roadmap 15 min\n- billing cutover date??\n';
const LOG = 'abc123 ship the billing cutover\ndef456 fix the retry\n';
const FORMATTED = '# Q3 sync\n\n## Agenda\n\n1. Roadmap (15 min)\n2. Billing cutover date\n';

const FILES = [
  { path: 'notes.txt', size: RAW.length, type: 'text/plain; charset=utf-8' },
  { path: 'log.md', size: LOG.length, type: 'text/markdown; charset=utf-8' },
  { path: 'hero.png', size: 9, type: 'image/png' },
];

function seededEnv(ai?: AiRunner, files = FILES): TestEnv {
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    ai,
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: JSON.stringify({
        space: SPACE, hash: HASH, uploader: 'tom', createdAt: NOW, expiresAt: null, files,
      }),
      [`${SPACE}/${HASH}/f/notes.txt`]: RAW,
      [`${SPACE}/${HASH}/f/log.md`]: LOG,
      [`${SPACE}/${HASH}/f/hero.png`]: 'PNGBYTES',
    },
  });
}

/** The generate route's body, so a case can also send one the route refuses. */
interface GenerateBody {
  name?: string;
  sources: string[];
}

async function gen(env: TestEnv, body: GenerateBody, c?: string) {
  const token = c ?? await mintAdminToken(KEYS, SPACE, HASH, NOW + ADMIN_SECS);
  return fetchWorker(env, new Request(
    `https://share.test/${SPACE}/${HASH}/generate?c=${token}`,
    { method: 'POST', body: JSON.stringify(body) },
  ));
}

describe('POST /<space>/<hash>/generate', () => {
  /* The document is the only write. meta.json is left exactly as it was, which
     is what makes two runs finishing at once unable to drop each other: there is
     no manifest to read, modify, and write back. */
  it('lands the output stamped and writes nothing else', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    const before = env.BUCKET.objects.get(`${SPACE}/${HASH}/meta.json`);
    const res = await gen(env, { name: 'agenda', sources: ['notes.txt'] });
    expect(res.status).toBe(201);
    const body = await res.json<{ path: string; bare: string }>();
    expect(body.path).toMatch(/^agenda\.\d+\.md$/);
    expect(body.bare).toBe('agenda.md');

    expect(env.BUCKET.objects.get(`${SPACE}/${HASH}/f/${body.path}`)).toBe(FORMATTED);
    expect(env.BUCKET.objects.get(`${SPACE}/${HASH}/meta.json`)).toBe(before);
    const meta = await readMeta(env, SPACE, HASH);
    expect(meta?.files.map((f) => f.path)).not.toContain(body.path);
    // The sources are untouched: a generation adds, never rewrites.
    expect(env.BUCKET.objects.get(`${SPACE}/${HASH}/f/notes.txt`)).toBe(RAW);
  });

  /* The version is discovered by listing, so it has to answer on its own URL and
     under the bare alias without anything having recorded it. */
  it('serves the version it just wrote, and the bare name follows it', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    const { path } = await (await gen(env, { name: 'agenda', sources: ['notes.txt'] }))
      .json<{ path: string }>();

    for (const url of [path, 'agenda.md']) {
      const res = await fetchWorker(env, new Request(`https://share.test/${SPACE}/${HASH}/${url}?raw`));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(FORMATTED);
    }
  });

  /* Two runs in one second would collide on the stamp, which the plan forbids:
     an older version keeps its own URL, so nothing may overwrite one. */
  it('steps the stamp forward rather than overwriting a version', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    const first = await (await gen(env, { name: 'deck', sources: ['log.md'] })).json<{ path: string }>();
    const second = await (await gen(env, { name: 'deck', sources: ['log.md'] })).json<{ path: string }>();
    expect(second.path).not.toBe(first.path);
    expect(env.BUCKET.objects.get(`${SPACE}/${HASH}/f/${first.path}`)).toBe(FORMATTED);
  });

  /* The working page submits a form into a new tab, so the tab that held through
     the model call has to land on the version rather than on a JSON blob. */
  it('answers a form POST with a 303 to the version it wrote', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    const token = await mintAdminToken(KEYS, SPACE, HASH, NOW + ADMIN_SECS);
    const form = new URLSearchParams({ name: 'deck' });
    form.append('sources', 'log.md');
    const res = await fetchWorker(env, new Request(
      `https://share.test/${SPACE}/${HASH}/generate?c=${token}`,
      {
        method: 'POST',
        body: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    ));
    expect(res.status).toBe(303);
    // Relative, so it resolves beside `generate` and drops the token.
    expect(res.headers.get('location')).toMatch(/^deck\.\d+\.md$/);
  });

  it('answers a form POST it refuses with a page, not JSON', async () => {
    const env = seededEnv(memoryAi([new Error('boom')]));
    const token = await mintAdminToken(KEYS, SPACE, HASH, NOW + ADMIN_SECS);
    const form = new URLSearchParams({ name: 'deck' });
    form.append('sources', 'log.md');
    const res = await fetchWorker(env, new Request(
      `https://share.test/${SPACE}/${HASH}/generate?c=${token}`,
      {
        method: 'POST',
        body: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    ));
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('the model call failed');
  });

  /* Many-to-one is the point: the material for a deck is a notes file plus a
     log plus a transcript, and one prompt composing them is why the working
     page asks which files feed it. */
  it('composes two sources into one input block, in the ticked order', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const env = seededEnv(ai);
    const res = await gen(env, { name: 'deck', sources: ['log.md', 'notes.txt'] });
    expect(res.status).toBe(201);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].model).toBe(MODEL);
    const [system, user] = ai.calls[0].input.messages;
    expect(system.content).toBe(SYSTEM);
    expect(user.content).toContain(promptFor('deck'));
    expect(user.content).toContain('<file name="log.md">');
    expect(user.content).toContain('<file name="notes.txt">');
    expect(user.content.indexOf('log.md')).toBeLessThan(user.content.indexOf('notes.txt'));
    expect(user.content).toContain('2 files');
    // One block, one document out.
    expect(user.content.match(/<input>/g)).toHaveLength(1);
  });

  it('decodes the OpenAI answer shape too', async () => {
    const env = seededEnv(memoryAi([{ choices: [{ message: { content: FORMATTED } }] }]));
    expect((await gen(env, { name: 'deck', sources: ['log.md'] })).status).toBe(201);
  });

  it('refuses a source that is not text, and one this share does not hold', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    expect((await gen(env, { name: 'deck', sources: ['hero.png'] })).status).toBe(400);
    expect((await gen(env, { name: 'deck', sources: ['missing.md'] })).status).toBe(400);
  });

  it('refuses an unknown name, naming the ones it takes', async () => {
    const env = seededEnv(memoryAi([]));
    const res = await gen(env, { name: 'sonnet', sources: ['notes.txt'] });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('ship-summary');
  });

  it('refuses an empty pick and a body it cannot read', async () => {
    const env = seededEnv(memoryAi([]));
    expect((await gen(env, { name: 'deck', sources: [] })).status).toBe(400);
    expect((await gen(env, { sources: ['notes.txt'] })).status).toBe(400);
  });

  /* Per run, not per file: refused with the count and the files, because a
     quiet truncation produces a confidently wrong deck. */
  it('refuses an over-budget run with the byte count and the files', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const half = Math.ceil(MAX_TRANSFORM_BYTES * 0.6);
    const env = seededEnv(ai, [
      { path: 'a.md', size: half, type: 'text/markdown' },
      { path: 'b.md', size: half, type: 'text/markdown' },
    ]);
    const res = await gen(env, { name: 'deck', sources: ['a.md', 'b.md'] });
    expect(res.status).toBe(413);
    const body = await res.json<{ error: string; files: string[] }>();
    expect(body.error).toContain(String(half * 2));
    expect(body.files).toEqual(['a.md', 'b.md']);
    expect(ai.calls).toHaveLength(0);
  });

  /* The bound on what a leaked working link can spend at the model. Counted by
     listing, before the call, so the refused run costs nothing. */
  it('refuses the run past MAX_VERSIONS of one name without calling the model', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const env = seededEnv(ai);
    for (let i = 0; i < MAX_VERSIONS; i++) {
      env.BUCKET.objects.set(`${SPACE}/${HASH}/f/deck.${1000 + i}.md`, FORMATTED);
    }
    // Another name's versions, and a look-alike upload, do not count against deck.
    env.BUCKET.objects.set(`${SPACE}/${HASH}/f/agenda.1000.md`, FORMATTED);
    env.BUCKET.objects.set(`${SPACE}/${HASH}/f/deck.notes.md`, FORMATTED);
    const res = await gen(env, { name: 'deck', sources: ['log.md'] });
    expect(res.status).toBe(429);
    expect(ai.calls).toHaveLength(0);
    expect((await gen(env, { name: 'agenda', sources: ['log.md'] })).status).toBe(201);
  });

  it('503s without the AI binding, and 502s a failed call, storing nothing', async () => {
    expect((await gen(seededEnv(), { name: 'deck', sources: ['log.md'] })).status).toBe(503);

    const env = seededEnv(memoryAi([new Error('boom')]));
    const before = env.BUCKET.objects.size;
    expect((await gen(env, { name: 'deck', sources: ['log.md'] })).status).toBe(502);
    expect(env.BUCKET.objects.size).toBe(before);

    const undecodable = seededEnv(memoryAi([{ unexpected: true }]));
    expect((await gen(undecodable, { name: 'deck', sources: ['log.md'] })).status).toBe(502);
  });

  it('refuses a missing, foreign, or expired credential', async () => {
    const env = seededEnv(memoryAi([{ response: FORMATTED }]));
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect((await gen(env, { name: 'deck', sources: ['log.md'] }, stale)).status).toBe(401);
    const other = await mintAdminToken(KEYS, SPACE, 'Zz9dEf6hIj9k', NOW + ADMIN_SECS); // gitleaks:allow
    expect((await gen(env, { name: 'deck', sources: ['log.md'] }, other)).status).toBe(401);
  });
});

describe('the catalog', () => {
  it('holds the four names the working page offers, each with a prompt', () => {
    expect(GENERATIONS.map((g) => g.name)).toEqual(['deck', 'agenda', 'renewal', 'ship-summary']);
    for (const g of GENERATIONS) expect(g.prompt.length).toBeGreaterThan(100);
    expect(promptFor('fix')).toBeUndefined();
    expect(promptFor('presentation')).toBeUndefined();
    expect(promptFor('performance')).toBeUndefined();
  });

  it('names a single source by its filename rather than counting to one', () => {
    const input = buildInput('FORMAT', [{ path: 'notes.md', text: RAW }]);
    expect(input.messages[1].content).toContain('The input file is named notes.md');
  });
});

describe('decodeAiText and cleanOutput', () => {
  it('reads both answer shapes and refuses the rest', () => {
    expect(decodeAiText({ response: 'hi' })).toBe('hi');
    expect(decodeAiText({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    expect(decodeAiText({ choices: [] })).toBeNull();
    expect(decodeAiText('hi')).toBeNull();
    expect(decodeAiText(null)).toBeNull();
  });

  it('strips a wrapping fence and a thinking block, and refuses emptiness', () => {
    expect(cleanOutput('```markdown\n# doc\n```')).toBe('# doc');
    expect(cleanOutput('<think>hmm</think>\n# doc\n')).toBe('# doc');
    expect(cleanOutput('# doc\n')).toBe('# doc');
    expect(cleanOutput('<think>only thoughts</think>')).toBeNull();
    expect(cleanOutput('  \n')).toBeNull();
  });
});

describe('the system prompt guards the voice, not just the facts', () => {
  it('asks for a reformat and for the input sentences to survive', () => {
    expect(SYSTEM).toContain('reformat');
    expect(SYSTEM).toContain("Preserve the author's wording");
    /* The old wording asked for a rewrite and guarded only the facts, which is
       how a fast model at low effort flattened the voice while keeping every
       number. Pinned so the two words cannot drift back. */
    expect(SYSTEM).not.toContain('You rewrite');
  });
});
