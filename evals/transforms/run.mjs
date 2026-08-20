#!/usr/bin/env node
/* Model evals for src/transforms/: every prompt against every fixture on the
   live model, graded by checks.mjs. Runs src/transforms/prompt.ts itself
   (node type stripping), so the messages, decoding, and cleanup under eval
   are the exact code path the Worker runs. Never in CI: it spends inference
   and carries an API token. See README.md here. */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { MODEL, repairNote, runPrompt } from '../../src/transforms/prompt.ts';
import { checksFor } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, '..', '..', 'src', 'transforms');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN; // guarddog env-read: the documented Workers AI credential, spent only as the Bearer on api.cloudflare.com below, never printed, and this script never runs in CI.
if (!ACCOUNT || !TOKEN) {
  console.error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN ("Workers AI" token template)');
  process.exit(2);
}

/* The binding's shape over the REST endpoint, so runPrompt cannot tell the
   difference between this and env.AI. */
const ai = {
  async run(model, input) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${model}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    const body = await res.json();
    if (!res.ok || body.success === false) {
      throw new Error(`ai/run ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    }
    return body.result ?? body;
  },
};

const prompts = new Map();
for (const f of await readdir(PROMPTS)) {
  if (f.endsWith('.md')) prompts.set(basename(f, '.md'), await readFile(join(PROMPTS, f), 'utf8'));
}
const fixtures = new Map();
for (const f of await readdir(join(HERE, 'fixtures'))) {
  if (/\.(md|txt)$/.test(f)) fixtures.set(f, await readFile(join(HERE, 'fixtures', f), 'utf8'));
}
const MUST = JSON.parse(await readFile(join(HERE, 'fixtures', 'must-keep.json'), 'utf8'));

/* `fix` reads a finished deck, not raw notes, so it takes its own fixture rather
   than the cross-product. Pointing it at meeting notes would grade a repair pass
   on material it is never handed, and every case would fail for the wrong
   reason. `slides` is what upload.ts passes it from the check verdict. */
const REPAIR_CASE = {
  name: 'fix',
  file: 'clipping-deck.md',
  slides: [3],
};

const filter = process.argv[2] ?? '';
const cases = [];
for (const [name, prompt] of prompts) {
  if (name === REPAIR_CASE.name) {
    const id = `${name}:${REPAIR_CASE.file}`;
    const text = fixtures.get(REPAIR_CASE.file);
    if (text !== undefined && id.includes(filter)) {
      cases.push({ id, name, prompt, file: REPAIR_CASE.file, text, slides: REPAIR_CASE.slides });
    }
    continue;
  }
  for (const [file, text] of fixtures) {
    if (file === REPAIR_CASE.file) continue; // a finished deck is not raw material
    const id = `${name}:${file}`;
    if (id.includes(filter)) cases.push({ id, name, prompt, file, text });
  }
}
if (cases.length === 0) {
  console.error(`no case matches "${filter}"`);
  process.exit(2);
}

const outDir = join(HERE, 'out');
await mkdir(outDir, { recursive: true });

async function grade(c) {
  /* `repairNote` rather than a hand-written string, so the repair case is graded
     on the exact note the Worker builds from the check verdict. */
  const output = await runPrompt(
    ai, c.prompt, c.file, c.text, c.slides ? repairNote(c.slides) : undefined,
  );
  if (output === null) {
    return { id: c.id, failed: [{ name: 'answered', pass: false, detail: 'runPrompt returned null' }] };
  }
  await writeFile(join(outDir, `${c.name}--${c.file}.md`), `${output}\n`);
  const facts = MUST[c.file] ?? { keep: [], drop: [] };
  return { id: c.id, failed: checksFor(c.name, output, c.text, facts).filter((k) => !k.pass) };
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
  const why = r.failed.map((f) => (f.detail ? `${f.name} (${f.detail})` : f.name)).join('; ');
  console.log(`FAIL ${r.id} - ${why}`);
}
console.log(`\n${results.length - bad}/${results.length} pass; outputs in evals/transforms/out/`);
process.exit(bad === 0 ? 0 : 1);
