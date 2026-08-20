import { describe, expect, it } from 'vitest';
import type { AiRunner } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { readMeta } from '../src/lib/r2';
import { sha256hex } from '../src/lib/auth';
import { MAX_TRANSFORM_BYTES, TRANSFORMS } from '../src/transforms';
import { MODEL, SYSTEM, cleanOutput, decodeAiText } from '../src/transforms/prompt';
import type { TestEnv } from './bindings';
import { memoryAi, testEnv } from './bindings';

const SPACE = 'acme';
const RAW = 'q3 sync thursday\n- roadmap 15 min\n- billing cutover date??\n';
const FORMATTED = '# Q3 sync\n\n## Agenda\n\n1. Roadmap (15 min)\n2. Billing cutover date\n';

async function stubEnv(ai?: AiRunner): Promise<TestEnv> {
  return testEnv({ tokens: JSON.stringify({ tom: await sha256hex('raw-token') }), ai });
}

async function put(env: TestEnv, query: string, files: [string, string][]) {
  const form = new FormData();
  for (const [name, text] of files) form.append('f', new Blob([text]), name);
  const req = new Request(`https://share.test/up/${SPACE}${query}`, {
    method: 'POST',
    headers: { authorization: 'Bearer raw-token', accept: 'application/json' },
    body: form,
  });
  return upload(req, env, SPACE);
}

describe('?transform= rewrites the text files before they land', () => {
  it('stores the model output, renames .txt to .md, and records the transform', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const env = await stubEnv(ai);
    const res = await put(env, '?transform=agenda', [['notes.txt', RAW]]);
    expect(res.status).toBe(201);
    const body = await res.json<{ hash: string; transform: string; files: string[] }>();
    expect(body.transform).toBe('agenda');
    expect(body.files).toEqual(['notes.md']);

    expect(env.BUCKET.objects.get(`${SPACE}/${body.hash}/f/notes.md`)).toBe(FORMATTED);
    expect(env.BUCKET.objects.has(`${SPACE}/${body.hash}/f/notes.txt`)).toBe(false);
    expect((await readMeta(env, SPACE, body.hash))?.transform).toBe('agenda');
  });

  it('sends the registered prompt, the filename, and the raw text to the model', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    await put(await stubEnv(ai), '?transform=agenda', [['notes.txt', RAW]]);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].model).toBe(MODEL);
    const [system, user] = ai.calls[0].input.messages;
    expect(system.content).toBe(SYSTEM);
    expect(user.content).toContain(TRANSFORMS.get('agenda'));
    expect(user.content).toContain('notes.txt');
    expect(user.content).toContain(RAW);
  });

  it('decodes the OpenAI answer shape too', async () => {
    const ai = memoryAi([{ choices: [{ message: { content: FORMATTED } }] }]);
    const env = await stubEnv(ai);
    const res = await put(env, '?transform=deck', [['notes.md', RAW]]);
    expect(res.status).toBe(201);
    const body = await res.json<{ hash: string }>();
    expect(env.BUCKET.objects.get(`${SPACE}/${body.hash}/f/notes.md`)).toBe(FORMATTED);
  });

  it('leaves the files that are not text alone', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const env = await stubEnv(ai);
    const res = await put(env, '?transform=deck', [['notes.md', RAW], ['logo.png', 'PNGBYTES']]);
    const body = await res.json<{ hash: string; files: string[] }>();
    expect(ai.calls).toHaveLength(1);
    expect(body.files.sort()).toEqual(['logo.png', 'notes.md']);
    expect(env.BUCKET.objects.get(`${SPACE}/${body.hash}/f/logo.png`)).toBe('PNGBYTES');
  });
});

describe('?transform= failure modes store nothing', () => {
  it('rejects an unknown name, naming the known ones', async () => {
    const res = await put(await stubEnv(memoryAi([])), '?transform=sonnet', [['n.md', RAW]]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('agenda');
  });

  it('503s without the AI binding', async () => {
    expect((await put(await stubEnv(), '?transform=agenda', [['n.md', RAW]])).status).toBe(503);
  });

  it('400s when no file is text', async () => {
    const res = await put(await stubEnv(memoryAi([])), '?transform=agenda', [['shot.png', 'PNG']]);
    expect(res.status).toBe(400);
  });

  it('413s an oversized text file', async () => {
    const big = 'a'.repeat(MAX_TRANSFORM_BYTES + 1);
    const res = await put(await stubEnv(memoryAi([])), '?transform=agenda', [['n.md', big]]);
    expect(res.status).toBe(413);
  });

  it('400s when the .txt rename collides with an uploaded .md', async () => {
    const ai = memoryAi([{ response: FORMATTED }]);
    const res = await put(await stubEnv(ai), '?transform=agenda', [['n.txt', RAW], ['n.md', RAW]]);
    expect(res.status).toBe(400);
  });

  it('502s when the model call throws, with an empty bucket', async () => {
    const env = await stubEnv(memoryAi([new Error('boom')]));
    const res = await put(env, '?transform=agenda', [['n.md', RAW]]);
    expect(res.status).toBe(502);
    expect(env.BUCKET.objects.size).toBe(0);
  });

  it('502s on an undecodable answer', async () => {
    const env = await stubEnv(memoryAi([{ unexpected: true }]));
    expect((await put(env, '?transform=agenda', [['n.md', RAW]])).status).toBe(502);
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

describe('the repair pass', () => {
  const DECK = '---\nmarp: true\n---\n\n# a deck\n';

  it('names the clipped slides to the model and changes nothing else', async () => {
    const ai = memoryAi([{ response: DECK }]);
    await put(await stubEnv(ai), '?transform=fix&slides=3,5', [['deck.md', DECK]]);
    const [, user] = ai.calls[0].input.messages;
    expect(user.content).toContain(TRANSFORMS.get('fix'));
    expect(user.content).toContain('Slides 3, 5 clip the page');
    expect(user.content).toContain('the only slides you may change');
  });

  it('says "slide" for one, so the instruction never reads as a plural of one', async () => {
    const ai = memoryAi([{ response: DECK }]);
    await put(await stubEnv(ai), '?transform=fix&slides=7', [['deck.md', DECK]]);
    expect(ai.calls[0].input.messages[1].content).toContain('Slide 7 clips the page');
  });

  it('carries no slide note when none was named', async () => {
    const ai = memoryAi([{ response: DECK }]);
    await put(await stubEnv(ai), '?transform=fix', [['deck.md', DECK]]);
    expect(ai.calls[0].input.messages[1].content).not.toContain('clip the page');
  });

  /* The list reaches a prompt, so it is parsed at the edge rather than passed
     through as prose the model has to interpret. */
  it('400s a junk slide list, and never calls the model', async () => {
    const ai = memoryAi([{ response: DECK }]);
    const res = await put(await stubEnv(ai), '?transform=fix&slides=3,nope', [['deck.md', DECK]]);
    expect(res.status).toBe(400);
    expect(ai.calls).toHaveLength(0);
  });

  it('400s slide 0 and a negative, which no deck has', async () => {
    for (const bad of ['0', '-2', '1.5']) {
      const res = await put(await stubEnv(memoryAi([])), `?transform=fix&slides=${bad}`, [['deck.md', DECK]]);
      expect(res.status).toBe(400);
    }
  });

  it('400s slides= against a restructure prompt, which would ignore it', async () => {
    const res = await put(await stubEnv(memoryAi([])), '?transform=deck&slides=3', [['deck.md', DECK]]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('transform=fix');
  });
});

describe('the system prompt guards the voice, not just the facts', () => {
  it('asks for a reformat and for the input sentences to survive', () => {
    expect(SYSTEM).toContain('reformat');
    expect(SYSTEM).toContain("Keep the author's wording");
    /* The old wording asked for a rewrite and guarded only the facts, which is
       how a fast model at low effort flattened the voice while keeping every
       number. Pinned so the two words cannot drift back. */
    expect(SYSTEM).not.toContain('You rewrite');
  });
});
