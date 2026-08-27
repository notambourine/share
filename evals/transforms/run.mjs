#!/usr/bin/env node
/* Model evals for src/transforms/: every prompt against every fixture on the
   live model, graded by checks.mjs. Runs src/transforms/prompt.ts itself
   (node type stripping), so the messages, decoding, and cleanup under eval
   are the exact code path the Worker runs. Never in CI: it spends inference
   and carries an API token. See README.md here. */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { MODEL, decodeAiText, runPrompt } from '../../src/transforms/prompt.ts';
import { checksFor } from './checks.mjs';

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
   concurrent calls in a batch log against the right id. */
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
      const preview = error
        ? `ERROR ${error}`
        : (decodeAiText(body?.result ?? body) ?? JSON.stringify(body)).slice(0, 600);
      const indented = preview.split('\n').map((line) => `    ${line}`).join('\n');
      console.error(`\n  --- [${res?.status ?? 'ERR'} ${Date.now() - startedAt}ms] ${caseId} ---\n${indented}\n`);
      if (error) throw new Error(error);
      return body.result ?? body;
    },
  };
}

const prompts = new Map();
for (const f of await readdir(PROMPTS)) {
  if (f.endsWith('.md')) prompts.set(basename(f, '.md'), await readFile(join(PROMPTS, f), 'utf8'));
}
const fixtures = new Map();
for (const f of await readdir(join(HERE, 'fixtures'))) {
  if (/\.(md|txt)$/.test(f)) fixtures.set(f, await readFile(join(HERE, 'fixtures', f), 'utf8'));
}
const MUST = JSON.parse(await readFile(join(HERE, 'fixtures', 'must-keep.json'), 'utf8'));

const filter = process.argv[2] ?? '';
const cases = [];
for (const [name, prompt] of prompts) {
  for (const [file, text] of fixtures) {
    const id = `${name}:${file}`;
    if (id.includes(filter)) cases.push({ id, name, prompt, file, text });
  }
}

/* One fixture per case here, where the Worker composes several: the graders
   score the format and the voice, and both read the same whatever the input was
   assembled from. A multi-source case would grade the join, not the prompt. */
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
  console.error(`  -> ${c.id}`);
  const output = await runPrompt(makeAi(c.id), c.prompt, [{ path: c.file, text: c.text }]);
  done++;
  if (output === null) {
    console.error(`  <- ${c.id} FAIL (null) [${done}/${cases.length}]`);
    return { id: c.id, failed: [{ name: 'answered', pass: false, detail: 'runPrompt returned null' }] };
  }
  await writeFile(join(outDir, `${c.name}--${c.file}.md`), `${output}\n`);
  const facts = MUST[c.file] ?? { keep: [], drop: [] };
  const failed = checksFor(c.name, output, c.text, facts).filter((k) => !k.pass);
  const status = failed.length === 0 ? 'PASS' : `FAIL - ${why(failed)}`;
  console.error(`  <- ${c.id} ${status} [${done}/${cases.length}]`);
  return { id: c.id, failed };
}

console.error(`${cases.length} cases against ${MODEL}`);
const results = [];
// 4 at a time: fast enough, and low enough to stay clear of rate limits.
for (let i = 0; i < cases.length; i += 4) {
  results.push(...await Promise.all(cases.slice(i, i + 4).map(grade)));
}

let bad = 0;
for (const r of results) {
  if (r.failed.length === 0) {
    console.log(`PASS ${r.id}`);
    continue;
  }
  bad++;
  console.log(`FAIL ${r.id} - ${why(r.failed)}`);
}
console.log(`\n${results.length - bad}/${results.length} pass; outputs in evals/transforms/out/, raw calls in evals/transforms/out/calls.jsonl`);
process.exit(bad === 0 ? 0 : 1);
