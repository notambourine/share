#!/usr/bin/env node
/* Model evals for src/transforms/: the cases in fixtures/cases.json on the live
   model, graded by checks.mjs. Runs src/transforms/prompt.ts itself (node type
   stripping), so the messages, decoding, and cleanup under eval are the exact
   code path the Worker runs, and grades through the Worker's own renderer. Never
   in CI: it spends inference and carries an API token. See README.md here. */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { MODEL, runPrompt } from '../../src/transforms/prompt.ts';
import { checksFor, verbatimShare } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, '..', '..', 'src', 'transforms');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN; // guarddog env-read: the documented Workers AI credential, spent only as the Bearer on api.cloudflare.com below, never printed, and this script never runs in CI.
if (!ACCOUNT || !TOKEN) {
  console.error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN ("Workers AI" token template)');
  process.exit(2);
}

const LOG = join(HERE, 'out', 'calls.jsonl');

/* The binding's shape over the REST endpoint, so runPrompt cannot tell the
   difference between this and env.AI. One shim per case (via caseId) so
   concurrent calls in a batch log against the right id. Every request and
   answer lands in calls.jsonl; nothing but the verdict reaches the console,
   because the documents themselves are what out/ is for. */
function makeAi(caseId) {
  return {
    async run(model, input) {
      const startedAt = Date.now();
      let res;
      let body;
      let error = null;
      try {
        res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        );
        body = await res.json();
        if (!res.ok || body.success === false) {
          error = `ai/run ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await appendFile(LOG, `${JSON.stringify({
        id: caseId, model, ms: Date.now() - startedAt,
        status: res?.status ?? null, request: input, response: body ?? null, error,
      })}\n`);
      if (error) throw new Error(error);
      return body.result ?? body;
    },
  };
}

const CASES = JSON.parse(await readFile(join(HERE, 'fixtures', 'cases.json'), 'utf8'));

const filter = process.argv[2] ?? '';
const cases = [];
for (const spec of CASES) {
  const id = `${spec.transform}:${spec.name}`;
  if (!id.includes(filter)) continue;
  cases.push({
    ...spec,
    id,
    prompt: await readFile(join(PROMPTS, `${spec.transform}.md`), 'utf8'),
    sources: await Promise.all(spec.sources.map(async (path) => ({
      path,
      text: await readFile(join(HERE, 'fixtures', path), 'utf8'),
    }))),
  });
}

if (cases.length === 0) {
  console.error(`no case matches "${filter}"`);
  process.exit(2);
}

const outDir = join(HERE, 'out');
await mkdir(outDir, { recursive: true });
await writeFile(LOG, '');

function why(failed) {
  return failed.map((f) => (f.detail ? `${f.name} (${f.detail})` : f.name)).join('; ');
}

let done = 0;
async function grade(c) {
  const output = await runPrompt(makeAi(c.id), c.prompt, c.sources);
  done++;
  if (output === null) {
    console.error(`  ${c.id} FAIL (null) [${done}/${cases.length}]`);
    return { id: c.id, failed: [{ name: 'answered', pass: false, detail: 'runPrompt returned null' }], voice: 0 };
  }
  await writeFile(join(outDir, `${c.transform}--${c.name}.md`), `${output}\n`);
  /* One input string for the graders, the same join the model saw, so a
     multi-source case grades against everything it was given. */
  const input = c.sources.map((s) => s.text).join('\n');
  const failed = checksFor(c.transform, output, input, c).filter((k) => !k.pass);
  const voice = verbatimShare(output, input);
  console.error(`  ${c.id} ${failed.length === 0 ? 'PASS' : 'FAIL'} [${done}/${cases.length}]`);
  return { id: c.id, failed, voice };
}

console.error(`${cases.length} cases against ${MODEL}`);
const results = [];
// 4 at a time: fast enough, and low enough to stay clear of rate limits.
for (let i = 0; i < cases.length; i += 4) {
  results.push(...await Promise.all(cases.slice(i, i + 4).map(grade)));
}

let bad = 0;
for (const r of results) {
  const voice = `voice ${(r.voice * 100).toFixed(0)}%`;
  if (r.failed.length === 0) {
    console.log(`PASS ${r.id.padEnd(28)} ${voice}`);
    continue;
  }
  bad++;
  console.log(`FAIL ${r.id.padEnd(28)} ${voice} - ${why(r.failed)}`);
}
console.log(`\n${results.length - bad}/${results.length} pass; outputs in evals/transforms/out/, raw calls in evals/transforms/out/calls.jsonl`);
console.log('voice is reported, never gated - see the note in checks.mjs. Read out/ for tone.');
process.exit(bad === 0 ? 0 : 1);
