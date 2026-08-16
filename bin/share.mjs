#!/usr/bin/env node
/* share: CLI for share.notambourine.com (R15).
   Token comes from $SHARE_TOKEN; run under the op prefix so the secret never
   lands in a transcript ($SHARE_URL overrides the host for dev):
     SHARE_TOKEN=op://Employee/share-token/credential op run -- share ...

   share put <space> <file|dir ...> [--ttl 90d|forever] [--ttl-idle 7d] [--tier signed]
   share sign <space>/<hash> [--ttl 30d] [--short]
   share short <space>/<hash> [--ttl 30d]
   share ls <space>
   share rm <space>/<hash>
*/
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import process from 'node:process';

const BASE = (process.env.SHARE_URL ?? 'https://share.notambourine.com').replace(/\/$/, '');
const TOKEN = process.env.SHARE_TOKEN;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--short') flags.short = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { pos, flags };
}

async function walk(root) {
  const s = await stat(root);
  if (s.isFile()) return [{ abs: root, rel: basename(root) }];
  const out = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath ?? e.path, e.name);
    const rel = relative(root, abs);
    if (rel.split('/').some((seg) => seg.startsWith('.'))) continue;
    out.push({ abs, rel });
  }
  return out;
}

async function api(path, init = {}) {
  if (!TOKEN) die('SHARE_TOKEN is not set. Run as: SHARE_TOKEN=op://Employee/share-token/credential op run -- share ...');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) die(`${res.status} ${text.trim()}`);
  return text;
}

const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = pos;

switch (cmd) {
  case 'put': {
    const [space, ...paths] = rest;
    if (!space || paths.length === 0) die('usage: share put <space> <file|dir ...>');
    const form = new FormData();
    let count = 0;
    for (const p of paths) {
      for (const { abs, rel } of await walk(p)) {
        form.append('f', new Blob([await readFile(abs)]), rel);
        count++;
      }
    }
    if (count === 0) die('nothing to upload');
    const q = new URLSearchParams();
    if (flags.ttl) q.set('ttl', flags.ttl);
    if (flags['ttl-idle']) q.set('idle', flags['ttl-idle']);
    if (flags.tier) q.set('tier', flags.tier);
    const body = await api(`/up/${space}${q.size ? `?${q}` : ''}`, { method: 'POST', body: form });
    const json = JSON.parse(body);
    console.log(json.url);
    if (flags.tier === 'signed') console.error(`signed tier: mint a link: share sign ${space}/${json.hash}`);
    break;
  }
  case 'sign':
  case 'short': {
    const [path] = rest;
    if (!path) die(`usage: share ${cmd} <space>/<hash>`);
    const body = await api('/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, ttl: flags.ttl, short: cmd === 'short' || !!flags.short }),
    });
    const json = JSON.parse(body);
    console.log(cmd === 'short' ? json.short : json.url);
    if (cmd === 'sign' && json.short) console.log(json.short);
    break;
  }
  case 'ls': {
    const [space] = rest;
    if (!space) die('usage: share ls <space>');
    console.log((await api(`/${space}/`)).trim());
    break;
  }
  case 'rm': {
    const [path] = rest;
    if (!path?.includes('/')) die('usage: share rm <space>/<hash>');
    await api(`/${path.replace(/\/$/, '')}/`, { method: 'DELETE' });
    console.log('moved to trash (purges in 90 days)');
    break;
  }
  default:
    die('commands: put, sign, short, ls, rm; see https://share.notambourine.com/llms.txt');
}
