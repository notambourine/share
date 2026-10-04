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
import { MODELS, modelFor, runPrompt } from '../../src/transforms/prompt.ts';
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
const DIM = process.stderr.isTTY ? '\x1b[2m' : '';
const RESET = process.stderr.isTTY ? '\x1b[0m' : '';
const model = modelFor(process.env.EVAL_MODEL ?? null);
if (!model) {
  console.error(`EVAL_MODEL is one of ${MODELS.map((m) => m.id).join(', ')}`);
  process.exit(2);
}

/* The binding's shape over the REST endpoint, so runPrompt cannot tell the
   difference between this and env.AI. It asks for a stream and echoes it live -
   reasoning dimmed, then the document - and hands runPrompt the assembled
   answer. Every request and answer also lands in calls.jsonl. */
function makeAi(caseId) {
  return {
    async run(model, input) {
      const startedAt = Date.now();
      let status = null;
      let error = null;
      let content = '';
      let reasoning = '';
      let usage = null;
      try {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, stream: true }),
          },
        );
        status = res.status;
        if (!res.ok || !res.body) {
          error = `ai/run ${res.status}: ${(await res.text()).slice(0, 300)}`;
        } else {
          let buf = '';
          let thinking = false;
          for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
            buf += chunk;
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') continue;
              const ev = JSON.parse(data);
              if (ev.usage) usage = ev.usage;
              const delta = ev.choices?.[0]?.delta ?? {};
              const think = delta.reasoning_content ?? delta.reasoning ?? '';
              const say = delta.content ?? ev.response ?? '';
              if (think) {
                if (!thinking) { process.stderr.write(DIM); thinking = true; }
                reasoning += think;
                process.stderr.write(think);
              }
              if (say) {
                if (thinking) { process.stderr.write(`${RESET}\n`); thinking = false; }
                content += say;
                process.stderr.write(say);
              }
            }
          }
          if (thinking) process.stderr.write(RESET);
          process.stderr.write('\n');
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const response = { choices: [{ message: { content, reasoning_content: reasoning } }], usage };
      await appendFile(LOG, `${JSON.stringify({
        id: caseId, model, ms: Date.now() - startedAt, status, request: input, response, error,
      })}\n`);
      if (error) throw new Error(error);
      return response;
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
  console.error(`\n=== ${c.id} [${done + 1}/${cases.length}]`);
  const output = await runPrompt(makeAi(c.id), c.prompt, c.sources, [], model);
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

console.error(`${cases.length} cases against ${model.id}`);
// One at a time, so the stream on screen belongs to one case.
const results = [];
for (const c of cases) results.push(await grade(c));

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
