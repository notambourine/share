#!/usr/bin/env node
/* nt-share: CLI for share.notambourine.com. One command per job, no plumbing.

   Every verb resolves its own credential: an upload uses the cached session
   token, mints one from 1Password when there is none, and re-mints once if the
   cached one died mid-run. The vault token is read straight into this process
   and never crosses a shell, so no `op run` prefix and nothing to echo.

   nt-share install                                     (put nt-share on PATH)
   nt-share put <space> <file|dir ...> [--tier signed] [--ttl 90d|forever]
                                       [--ttl-idle 7d] [--sign-ttl 30d] [--short]
   nt-share sign <space>/<hash> [--ttl 30d] [--short]   (re-sign an older artifact)
   nt-share short <space>/<hash> [--ttl 30d]
   nt-share ls <space>
   nt-share rm <space>/<hash>
   nt-share session [--ttl 5m] [--print]  (optional pre-mint, max 1h; --print echoes the token for curl)

   $SHARE_TOKEN takes a raw token or an op:// reference and skips the vault
   lookup. $SHARE_TOKEN_REF moves the vault item. $SHARE_URL points at a dev
   Worker. $XDG_CACHE_HOME moves the session cache.

   Node runs this .ts directly (type stripping, 22.18+), so keep the syntax
   erasable: no enum, no namespace, no parameter properties.
*/
import { readFile, readdir, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join, relative, basename, sep, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const BASE = (process.env.SHARE_URL ?? 'https://share.notambourine.com').replace(/\/$/, '');
const REF = process.env.SHARE_TOKEN_REF ?? 'op://Employee/share-token/credential';
/* ~/.cache on every platform, Windows included: one documented path beats the
   LOCALAPPDATA convention, and NTFS ACLs on the profile dir match 0600-in-home. */
const CACHE = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
  'notambourine-share', 'session.json',
);

interface Session {
  token: string;
  name: string;
  expiresAt: number;
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/* The server's JSON, decoded rather than asserted. A field the CLI prints has
   to exist before it is printed, or `undefined` reaches a terminal as a link. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function fields(body: string): { [key: string]: Json } {
  const record = decode(body);
  return record ?? die(`the server did not answer with a JSON object:\n${body.trim()}`);
}

function decode(body: string): { [key: string]: Json } | null {
  let parsed: Json;
  try {
    /* SAFETY: JSON.parse is typed `any`; Json is the grammar it can return,
       and every read below narrows before use. */
    parsed = JSON.parse(body) as Json;
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: Json): value is string {
  return typeof value === 'string';
}

function isNumber(value: Json): value is number {
  return typeof value === 'number';
}

function textAt(record: { [key: string]: Json }, key: string): string | null {
  const value = record[key];
  return isText(value) ? value : null;
}

function required(record: { [key: string]: Json }, key: string): string {
  return textAt(record, key) ?? die(`the server answered without a ${key}`);
}

/** null rather than a die: a stale cache file is a re-mint, not an error. */
function decodeSession(body: string): Session | null {
  const record = decode(body);
  if (!record) return null;
  const token = textAt(record, 'token');
  const name = textAt(record, 'name');
  const expiresAt = record.expiresAt;
  if (token === null || name === null || !isNumber(expiresAt)) return null;
  return { token, name, expiresAt };
}

/** Boolean flags land as "1", so every value is a string. */
function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--short' || a === '--print') flags[a.slice(2)] = '1';
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i] ?? '';
    else pos.push(a);
  }
  return { pos, flags };
}

/** Node types `spawnSync().error` as a plain Error; the errno is what tells a
    missing binary from a failed read. */
interface ErrnoError extends Error {
  code?: string;
}

function isErrno(err: Error): err is ErrnoError {
  return 'code' in err;
}

/* The one 1Password unlock. Stdout is a pipe, so the secret stays in this
   process and never reaches a terminal, a transcript, or a shell history. */
function vaultToken(): string {
  const env = process.env.SHARE_TOKEN;
  if (env && !env.startsWith('op://')) return env;
  const ref = env || REF;
  const r = spawnSync('op', ['read', '--no-newline', ref], { encoding: 'utf8' });
  if (r.error && isErrno(r.error) && r.error.code === 'ENOENT') {
    die('1Password CLI not found. Install it (brew install 1password-cli) and sign in, or set SHARE_TOKEN.');
  }
  const token = r.stdout?.trim();
  if (r.status !== 0 || !token) {
    die(`1Password could not read ${ref}:\n${(r.stderr ?? '').trim()}\n\nNo such item means you need a token: ask whoever runs the share repo to mint one (scripts/add-employee.sh) and save it at that path.`);
  }
  return token;
}

/** 30s of skew so a token never dies mid-request. */
async function cachedSession(): Promise<string | null> {
  let cached: string;
  try {
    cached = await readFile(CACHE, 'utf8');
  } catch {
    return null; // absent or unreadable = no session
  }
  const session = decodeSession(cached);
  if (!session) return null;
  return session.expiresAt - 30 > Date.now() / 1000 ? session.token : null;
}

async function mintSession(ttl?: string): Promise<Session> {
  const answer = await api(`/session${ttl ? `?ttl=${ttl}` : ''}`, { method: 'POST' }, vaultToken());
  const session = decodeSession(answer) ?? die(`the server did not answer with a session:\n${answer.trim()}`);
  await mkdir(join(CACHE, '..'), { recursive: true, mode: 0o700 });
  await writeFile(CACHE, `${JSON.stringify(session)}\n`, { mode: 0o600 });
  await chmod(CACHE, 0o600);
  return session;
}

async function walk(root: string): Promise<{ abs: string; rel: string }[]> {
  const s = await stat(root);
  if (s.isFile()) return [{ abs: root, rel: basename(root) }];
  const out: { abs: string; rel: string }[] = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath, e.name);
    // Forward slashes always: Windows relative() emits backslashes, which would
    // dodge the dotfile filter here and desync the upload paths from the URL.
    const rel = relative(root, abs).split(sep).join('/');
    if (rel.split('/').some((seg) => seg.startsWith('.'))) continue;
    out.push({ abs, rel });
  }
  return out;
}

const EXPIRED = Symbol('session expired');

async function api(path: string, init: RequestInit, token: string): Promise<string> {
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
    if (text.includes('session expired')) throw EXPIRED;
    die(`401 ${text.trim()}\nThe server rejects this token. The Worker TOKENS map has drifted from the vault: re-run scripts/add-employee.sh --map and re-paste it (rotate first if the token ever leaked).`);
  }
  // An error shell is an HTML page; printing it whole buries the status.
  if (!res.ok) die(`${res.status} ${text.startsWith('<') ? res.statusText : text.trim()}`);
  return text;
}

/** Uploads run on the cached session, minting or re-minting only when they must. */
async function upload(path: string, init: RequestInit): Promise<string> {
  const token = await cachedSession() ?? (await mintSession()).token;
  try {
    return await api(path, init, token);
  } catch (e) {
    if (e !== EXPIRED) throw e;
    return api(path, init, (await mintSession()).token);
  }
}

/* A shim, not a symlink to this file: it re-resolves the newest plugin copy on
   every run, so a plugin upgrade (a new version dir) never strands it. */
function shim(self: string): string {
  return `#!/bin/sh
# nt-share: newest installed nt-share CLI. Written by \`nt-share install\`.
cli=$(ls -d "$HOME"/.claude/plugins/cache/*/nt-share/*/bin/share.* 2>/dev/null | sort -V | tail -1)
[ -n "$cli" ] || cli=${JSON.stringify(self)}
[ -f "$cli" ] || { echo "nt-share: no CLI found; reinstall the nt-share plugin" >&2; exit 127; }
# Old node fails a .ts entry point with "Unknown file extension", which reads as a bug.
node -e 'const[a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<18)){console.error("nt-share needs node 22.18+, found "+process.versions.node);process.exit(1)}' || exit 1
exec node "$cli" "$@"
`;
}

const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = pos;

switch (cmd) {
  case 'install': {
    const dir = flags.dir ?? join(homedir(), '.local', 'bin');
    const target = join(dir, 'nt-share');
    await mkdir(dir, { recursive: true });
    await writeFile(target, shim(fileURLToPath(import.meta.url)), { mode: 0o755 });
    await chmod(target, 0o755);
    console.log(target);
    if (!(process.env.PATH ?? '').split(delimiter).includes(dir)) {
      console.error(`${dir} is not on PATH; call it by full path or add the dir`);
    }
    break;
  }
  case 'session': {
    const json = await mintSession(flags.ttl);
    if (flags.print) console.log(json.token);
    console.error(`session for ${json.name}, expires ${new Date(json.expiresAt * 1000).toISOString()}; cached at ${CACHE}`);
    break;
  }
  case 'put': {
    const [space, ...paths] = rest;
    if (!space || paths.length === 0) die('usage: nt-share put <space> <file|dir ...>');
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
    if (flags['sign-ttl']) q.set('sign', flags['sign-ttl']);
    if (flags.short) q.set('short', '1');
    const made = fields(await upload(
      `/up/${space}${q.size ? `?${q}` : ''}`, { method: 'POST', body: form },
    ));
    console.log(textAt(made, 'signedUrl') ?? required(made, 'url'));
    const shortUrl = textAt(made, 'short');
    if (shortUrl) console.log(shortUrl);
    break;
  }
  case 'sign':
  case 'short': {
    const [path] = rest;
    if (!path) die(`usage: nt-share ${cmd} <space>/<hash>`);
    const signed = fields(await api('/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, ttl: flags.ttl, short: cmd === 'short' || !!flags.short }),
    }, vaultToken()));
    console.log(cmd === 'short' ? required(signed, 'short') : required(signed, 'url'));
    const alsoShort = cmd === 'sign' ? textAt(signed, 'short') : null;
    if (alsoShort) console.log(alsoShort);
    break;
  }
  case 'ls': {
    const [space] = rest;
    if (!space) die('usage: nt-share ls <space>');
    console.log((await api(`/${space}/`, {}, vaultToken())).trim());
    break;
  }
  case 'rm': {
    const [path] = rest;
    if (!path?.includes('/')) die('usage: nt-share rm <space>/<hash>');
    await api(`/${path.replace(/\/$/, '')}/`, { method: 'DELETE' }, vaultToken());
    console.log('moved to trash (purges in 90 days)');
    break;
  }
  default:
    die('commands: install, put, sign, short, ls, rm, session; see https://share.notambourine.com/llms.txt');
}
