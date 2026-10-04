#!/usr/bin/env node
/* nt-share: CLI for share.notambourine.com. Two jobs, no plumbing.

   Uploads sit behind Cloudflare Access. `cloudflared` holds the SSO session, so
   the first run opens a browser sign-in and later runs reuse it.

   nt-share install                                     (put nt-share on PATH)
   nt-share put <space> <file|dir ...> [--ttl <dur>|forever]
   nt-share shipped <client> [--window 24h|7d|30d|month] [--as agenda|slides]

   $SHARE_URL points at a dev Worker.

   Node runs this .ts directly (type stripping, 22.18+), so keep the syntax
   erasable: no enum, no namespace, no parameter properties.
*/
import { readFile, readdir, stat, writeFile, mkdir, mkdtemp, rm, chmod } from 'node:fs/promises';
import { join, relative, basename, sep, delimiter } from 'node:path';
import { Buffer } from 'node:buffer';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
/* The installed shim imports this file where it lies rather than copying it,
   so reaching into src/ resolves at runtime too. The poster suffix is a
   contract with the Worker; both ends read it from the one declaration. */
import { posterPath } from '../src/lib/poster.ts';
import type { JsonObject } from '../src/lib/json.ts';
import { parseObject, textAt } from '../src/lib/json.ts';

const BASE = (process.env.SHARE_URL ?? 'https://share.notambourine.com').replace(/\/$/, '');
/** Any path the Access app covers names it; cloudflared keys its session by app. */
const APP = `${BASE}/up/`;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/* The server's JSON, decoded rather than asserted, through the same readers the
   Worker writes it with. A field the CLI prints has to exist before it is
   printed, or `undefined` reaches a terminal as a link. */
function fields(body: string): JsonObject {
  return parseObject(body) ?? die(`the server did not answer with a JSON object:\n${body.trim()}`);
}

function required(record: JsonObject, key: string): string {
  return textAt(record, key) ?? die(`the server answered without a ${key}`);
}

/** A flag that takes no value; anything else here would eat the next argument. */
const BARE = new Set(['json']);

/** Boolean flags land as "1", so every value is a string. */
function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && BARE.has(a.slice(2))) flags[a.slice(2)] = '1';
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

function cloudflared(args: string[], interactive: boolean) {
  const r = spawnSync('cloudflared', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', interactive ? 'inherit' : 'pipe'],
  });
  if (r.error && isErrno(r.error) && r.error.code === 'ENOENT') {
    die('cloudflared not found. Install it (brew install cloudflared) and re-run.');
  }
  return r;
}

/* A JWT is three base64url runs; login prints chatter around it, so the token
   is whatever line has that shape. */
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function tokenFrom(stdout: string | null): string | null {
  return (stdout ?? '').split('\n').map((l) => l.trim()).find((l) => JWT.test(l)) ?? null;
}

/* The SSO session, memoized so a run asks cloudflared once. A miss runs the
   browser login in the foreground; its prompts go to this terminal's stderr. */
let cachedToken: string | null = null;

function accessToken(): string {
  if (cachedToken !== null) return cachedToken;
  const token = tokenFrom(cloudflared(['access', 'token', `-app=${APP}`], false).stdout)
    ?? tokenFrom(cloudflared(['access', 'login', APP], true).stdout)
    ?? die(`Sign-in did not finish. Run: cloudflared access login ${APP}`);
  cachedToken = token;
  return token;
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

/* Poster frames. Slack builds an unfurl card from og: tags and needs a real
   picture; a video URL carries neither, so the frame is cut here and uploaded
   as a sibling. Worker-side is not an option - Browser Rendering drives a page,
   not a decoder. Suffix and record live in src/lib/poster.ts. */
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const POSTER_MAX = 1280;

function ran(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: 'buffer' });
  return !r.error && r.status === 0;
}

/**
 * ffmpeg first: a frame one second in beats the black opener most screen
 * recordings start on. qlmanage is the macOS fallback and picks its own frame.
 * Neither present means no poster and a text-only card, never a failed upload -
 * the video is what the user asked to share.
 */
async function posterFrame(abs: string): Promise<Buffer<ArrayBuffer> | null> {
  const dir = await mkdtemp(join(tmpdir(), 'nt-poster-'));
  const jpg = join(dir, 'poster.jpg');
  try {
    if (ran('ffmpeg', [
      '-v', 'error', '-y', '-ss', '1', '-i', abs, '-frames:v', '1',
      '-vf', `scale='min(${POSTER_MAX},iw)':-2`, '-q:v', '4', jpg,
    ])) return await readFile(jpg);

    if (process.platform === 'darwin'
      && ran('qlmanage', ['-t', '-s', String(POSTER_MAX), '-o', dir, abs])
      && ran('sips', ['-s', 'format', 'jpeg', join(dir, `${basename(abs)}.png`), '--out', jpg])
    ) return await readFile(jpg);

    return null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function api(path: string, init: RequestInit, token: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // Access answers a missing session with a redirect to its login page.
    redirect: 'manual',
    headers: {
      'cf-access-token': token,
      accept: 'application/json',
      ...init.headers,
    },
  });
  const text = await res.text();
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) {
    die(`Access refused the session. Sign in again: cloudflared access login ${APP}`);
  }
  // An error shell is an HTML page; printing it whole buries the status.
  if (!res.ok) die(`${res.status} ${text.startsWith('<') ? res.statusText : text.trim()}`);
  return text;
}

/* The resolver, not a symlink to this file: it re-finds the newest plugin copy
   on every run, so a plugin upgrade (a new version dir) never strands it. In
   node rather than shell because `sort -V` has no batch equivalent, and cmd.exe
   sorting names would rank 0.9.0 over 0.10.0. */
function resolver(self: string): string {
  return `#!/usr/bin/env node
// nt-share: runs the newest installed nt-share CLI. Written by \`nt-share install\`.
import { readdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const FALLBACK = ${JSON.stringify(self)};

// Old node fails a .ts entry point with "Unknown file extension", which reads as a bug.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(\`nt-share needs node 22.18+, found \${process.versions.node}\`);
  process.exit(1);
}

async function names(dir) {
  try {
    return await readdir(dir);
  } catch {
    return []; // absent level: no plugin copy down this path
  }
}

function newer(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const gap = (left[i] ?? 0) - (right[i] ?? 0);
    if (gap) return gap > 0;
  }
  return false;
}

const root = join(homedir(), '.claude', 'plugins', 'cache');
let best = null;
for (const market of await names(root)) {
  const versions = join(root, market, 'nt-share');
  for (const version of await names(versions)) {
    for (const file of await names(join(versions, version, 'cli'))) {
      if (!file.startsWith('share.')) continue;
      const path = join(versions, version, 'cli', file);
      if (!best || newer(version, best.version)) best = { version, path };
    }
  }
}

const cli = best ? best.path : FALLBACK;
// Checked before the import, never caught around it: a catch here would relabel
// every error the CLI itself throws as a missing install.
if (!await stat(cli).then(() => true, () => false)) {
  console.error('nt-share: no CLI found; reinstall the nt-share plugin');
  process.exit(127);
}

// Imported, not spawned: the CLI reads process.argv.slice(2), which is already
// this process's arguments, and a second node costs another cold start.
await import(pathToFileURL(cli).href);
`;
}

/* Two wrappers, both written on every platform: a shared home directory across
   WSL and Windows needs each, and neither costs anything where it is inert.
   CRLF on the batch file, which cmd.exe still wants. */
const SH_WRAPPER = `#!/bin/sh
# nt-share: written by \`nt-share install\`.
exec node "$(dirname "$0")/nt-share.mjs" "$@"
`;

const CMD_WRAPPER = [
  '@echo off',
  'rem nt-share: written by `nt-share install`.',
  'node "%~dp0nt-share.mjs" %*',
  '',
].join('\r\n');

const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = pos;

switch (cmd) {
  case 'install': {
    const dir = flags.dir ?? join(homedir(), '.local', 'bin');
    const target = join(dir, 'nt-share');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'nt-share.mjs'), resolver(fileURLToPath(import.meta.url)));
    await writeFile(target, SH_WRAPPER, { mode: 0o755 });
    await chmod(target, 0o755);
    await writeFile(`${target}.cmd`, CMD_WRAPPER);
    // stderr, like the PATH warning: stdout stays the verbs' answer channel.
    console.error(process.platform === 'win32' ? `${target}.cmd` : target);
    if (!(process.env.PATH ?? '').split(delimiter).includes(dir)) {
      console.error(`${dir} is not on PATH; call it by full path or add the dir`);
    }
    break;
  }
  case 'put': {
    const [space, ...paths] = rest;
    if (!space || paths.length === 0) {
      die('usage: nt-share put <space> <file|dir ...> [--ttl <dur>|forever]');
    }
    const form = new FormData();
    let count = 0;
    for (const p of paths) {
      for (const { abs, rel } of await walk(p)) {
        form.append('f', new Blob([await readFile(abs)]), rel); // guarddog keylogging: FormData.append, not input capture.
        count++;
        if (!VIDEO_EXT.test(rel)) continue;
        const poster = await posterFrame(abs);
        if (poster) form.append('f', new Blob([poster]), posterPath(rel));
      }
    }
    if (count === 0) die('nothing to upload');
    const q = new URLSearchParams();
    if (flags.ttl) q.set('ttl', flags.ttl);
    const made = fields(await api(
      `/up/${space}${q.size ? `?${q}` : ''}`, { method: 'POST', body: form }, accessToken(),
    ));
    console.log(required(made, 'url'));
    // stderr, labeled: stdout is the link you hand over, so a pipe never grabs
    // the sender's own page.
    const adminUrl = textAt(made, 'adminUrl');
    if (adminUrl) console.error(`working page: ${adminUrl}`);
    break;
  }
  case 'shipped': {
    const [client] = rest;
    if (!client) die('usage: nt-share shipped <client> [--window 24h|7d|30d|month] [--as agenda|slides]');
    const body = new URLSearchParams({ client, window: flags.window ?? '7d', format: flags.as ?? 'agenda' });
    const made = fields(await api('/admin/shipped', { method: 'POST', body }, accessToken()));
    console.log(required(made, 'url'));
    console.error(`pdf: ${required(made, 'pdf')}`);
    console.error(`working page: ${required(made, 'adminUrl')}`);
    if (made['empty'] === true) console.error('nothing merged or released in that window; the link is the empty digest');
    break;
  }
  default:
    die('commands: install, put, shipped; see https://share.notambourine.com/llms.txt');
}
