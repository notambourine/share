#!/usr/bin/env node
/* share: CLI for share.notambourine.com (R15).
   Token comes from $SHARE_TOKEN; run under the op prefix so the secret never
   lands in a transcript ($SHARE_URL overrides the host for dev):
     SHARE_TOKEN=op://Employee/share-token/credential op run -- share ...

   Uploading more than one thing? Mint a session once (one 1Password unlock).
   The upload-only session token caches to disk - AWS-STS style, 0600 under
   $XDG_CACHE_HOME - and every put until it expires needs no token at all.
   sign, ls, and rm still take the vault token under op run:
     SHARE_TOKEN=op://Employee/share-token/credential op run -- share session
     share put ...

   share session [--ttl 5m] [--print]  (max 1h; --print echoes the raw token for curl; also the preflight: 401 = server rejects your vault token)
   share put <space> <file|dir ...> [--ttl 90d|forever] [--ttl-idle 7d] [--tier signed]
   share sign <space>/<hash> [--ttl 30d] [--short]
   share short <space>/<hash> [--ttl 30d]
   share ls <space>
   share rm <space>/<hash>
*/
import { readFile, readdir, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

const BASE = (process.env.SHARE_URL ?? 'https://share.notambourine.com').replace(/\/$/, '');
const TOKEN = process.env.SHARE_TOKEN;
const CACHE = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
  'notambourine-share', 'session.json',
);

/** 30s of skew so a token never dies mid-request. */
async function cachedToken() {
  try {
    const j = JSON.parse(await readFile(CACHE, 'utf8'));
    if (j.token && j.expiresAt - 30 > Date.now() / 1000) return j.token;
  } catch { /* absent or unreadable = no session */ }
  return null;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--short' || a === '--print') flags[a.slice(2)] = true;
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
  const token = TOKEN ?? await cachedToken();
  if (!token) {
    die('No token: SHARE_TOKEN is unset and no live session is cached. Mint one:\n  SHARE_TOKEN=op://Employee/share-token/credential op run -- share session');
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  if (res.status === 401) {
    if (text.includes('session expired')) die(`401 ${text.trim()}\nRe-run \`share session\` (under op run) and retry with the fresh token.`);
    if (text.includes('only authorizes /up')) die(`401 ${text.trim()}`);
    die(`401 ${text.trim()}\nThe server rejects this token. If op read works, the Worker TOKENS map has drifted from the vault: re-run scripts/add-employee.sh --map and re-paste it (rotate first if the token ever leaked).`);
  }
  if (!res.ok) die(`${res.status} ${text.trim()}`);
  return text;
}

const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = pos;

switch (cmd) {
  case 'session': {
    if (!TOKEN) die('session needs the vault token. Run as:\n  SHARE_TOKEN=op://Employee/share-token/credential op run -- share session');
    const q = flags.ttl ? `?ttl=${flags.ttl}` : '';
    const json = JSON.parse(await api(`/session${q}`, { method: 'POST' }));
    await mkdir(join(CACHE, '..'), { recursive: true, mode: 0o700 });
    await writeFile(CACHE, `${JSON.stringify(json)}\n`, { mode: 0o600 });
    await chmod(CACHE, 0o600);
    if (flags.print) console.log(json.token);
    console.error(`session for ${json.name}, expires ${new Date(json.expiresAt * 1000).toISOString()}; cached at ${CACHE}`);
    break;
  }
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
    die('commands: session, put, sign, short, ls, rm; see https://share.notambourine.com/llms.txt');
}
