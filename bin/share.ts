#!/usr/bin/env node
/* nt-share: CLI for share.notambourine.com. One command per job, no plumbing.

   Every verb resolves its own credential: an upload uses the cached session
   token, mints one from 1Password when there is none, and re-mints once if the
   cached one died mid-run. The vault token is read straight into this process
   and never crosses a shell, so no `op run` prefix and nothing to echo.

   nt-share install                                     (put nt-share on PATH)
   nt-share put <space> <file|dir ...> [--tier signed] [--ttl <dur>|forever]
                                       [--sign-ttl <dur>]
                                       [--transform agenda|renewal|performance|presentation|deck]
   nt-share put <space> --clip [--name shot.png]        (the image on the clipboard)
   nt-share sign <space>/<hash> [--ttl 30d]             (re-sign an older artifact)
   nt-share admin <space>/<hash>                        (re-open the 5-minute admin link)
   nt-share check <space>/<hash> [--json]               (renders landed, and whether a slide clips)
   nt-share ls <space>
   nt-share rm <space>/<hash>

   $SHARE_TOKEN takes a raw token or an op:// reference and skips the vault
   lookup. $SHARE_TOKEN_REF moves the vault item. $SHARE_URL points at a dev
   Worker. $XDG_CACHE_HOME moves the session cache.

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
import { isJsonObject, numberAt, numbersAt, parseObject, recordsAt, textAt, textsAt } from '../src/lib/json.ts';

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

/* The server's JSON, decoded rather than asserted, through the same readers the
   Worker writes it with. A field the CLI prints has to exist before it is
   printed, or `undefined` reaches a terminal as a link. */
function fields(body: string): JsonObject {
  return parseObject(body) ?? die(`the server did not answer with a JSON object:\n${body.trim()}`);
}

function required(record: JsonObject, key: string): string {
  return textAt(record, key) ?? die(`the server answered without a ${key}`);
}

/** One status row, narrowed. `check` is null on anything that is not a deck. */
interface SourceStatus {
  path: string;
  rendered: string[];
  slides: number;
  overflow: number[] | null;
}

function decodeStatus(body: string): SourceStatus[] {
  const sources = recordsAt(fields(body), 'sources');
  if (!sources) die(`the server answered without sources:\n${body.trim()}`);
  return sources.map((row) => {
    const check = row['check'];
    const clip = isJsonObject(check) ? check : null;
    return {
      path: required(row, 'path'),
      rendered: textsAt(row, 'rendered'),
      slides: clip ? numberAt(clip, 'slides') ?? 0 : 0,
      overflow: clip ? numbersAt(clip, 'overflow') : null,
    };
  });
}

/** Nothing rendered yet reads as pending; a deck says whether it clips. */
function verdict(s: SourceStatus): string {
  if (s.rendered.length === 0) return '(pending)';
  const formats = s.rendered.join(' ');
  if (!s.overflow) return formats;
  const clip = s.overflow.length === 0
    ? 'ok'
    : `overflow on ${s.overflow.join(', ')}`;
  return `${formats}   ${s.slides} slides, ${clip}`;
}

/** null rather than a die: a stale cache file is a re-mint, not an error. */
function decodeSession(body: string): Session | null {
  const record = parseObject(body);
  if (!record) return null;
  const token = textAt(record, 'token');
  const name = textAt(record, 'name');
  const expiresAt = numberAt(record, 'expiresAt');
  if (token === null || name === null || expiresAt === null) return null;
  return { token, name, expiresAt };
}

/** A flag that takes no value; anything else here would eat the next argument. */
const BARE = new Set(['clip', 'json']);

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

async function mintSession(): Promise<Session> {
  const answer = await api('/session', { method: 'POST' }, vaultToken());
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

/* Clipboard, one shell-out per platform, bytes back over stdout rather than a
   temp file: a pasted screenshot should not outlive the upload on disk. */
const CLIP_MAX = 64 * 1024 * 1024;
const NO_IMAGE = 'no image on the clipboard (copy one, then rerun)';

/** An empty clipboard and a sandbox that blocks the pasteboard both come back
    as a failed read, so the tool's own words are the only way to tell them
    apart. Never fold one into the other. */
function clipFail(detail: string): never {
  return die(`cannot read the clipboard: ${detail.trim() || 'no output'}`);
}

function macClipboard(): Buffer<ArrayBuffer> {
  const r = spawnSync('osascript', ['-e', 'the clipboard as «class PNGf»'], {
    encoding: 'utf8', maxBuffer: CLIP_MAX,
  });
  /* Loose, not anchored on the «data ...» wrapper osascript prints around the
     hex: those guillemets arrive in the system encoding. Whitespace comes out
     of the capture, not the haystack, because the wrapper holds a space. */
  const hex = /data PNGf([0-9a-fA-F\s]+)/.exec(r.stdout);
  if (hex) return Buffer.from(hex[1].replace(/\s+/g, ''), 'hex');
  const err = r.stderr ?? '';
  // -1700 is AppleScript's coercion failure: nothing image-shaped is there.
  return err.includes('-1700') ? die(NO_IMAGE) : clipFail(err || r.stdout);
}

/* -EncodedCommand takes a UTF-16 base64 script, so no Windows quoting rule can
   mangle it, and the clipboard API only answers on an STA thread. */
const WIN_CLIP = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
  '$img = [System.Windows.Forms.Clipboard]::GetImage()',
  'if ($null -eq $img) { exit 3 }',
  '$ms = New-Object System.IO.MemoryStream',
  '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
  '[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))',
].join('\n');

function winClipboard(): Buffer<ArrayBuffer> {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
      Buffer.from(WIN_CLIP, 'utf16le').toString('base64')],
    { encoding: 'utf8', maxBuffer: CLIP_MAX },
  );
  if (r.status === 3) die(NO_IMAGE); // GetImage returned null
  const b64 = r.status === 0 ? r.stdout.trim() : '';
  return b64 ? Buffer.from(b64, 'base64') : clipFail(r.stderr ?? '');
}

/** Wayland first, then X11. Both write the PNG raw, so no encoding here. */
const LINUX_CLIP: [string, string[]][] = [
  ['wl-paste', ['--no-newline', '--type', 'image/png']],
  ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
];

function linuxClipboard(): Buffer<ArrayBuffer> {
  const notes: string[] = [];
  for (const [cmd, args] of LINUX_CLIP) {
    const r = spawnSync(cmd, args, { maxBuffer: CLIP_MAX });
    if (r.error) continue; // not on PATH; try the other one
    if (r.status === 0 && r.stdout.length > 0) return Buffer.from(r.stdout);
    notes.push(`${cmd}: ${r.stderr.toString().trim() || `exit ${r.status}`}`);
  }
  if (notes.length === 0) {
    die('no clipboard tool: install wl-clipboard (Wayland) or xclip (X11)');
  }
  // Both tools say "no image" and "no display" the same way, through an exit
  // code, so print the guess and their words rather than pick one.
  return die(`${NO_IMAGE}\n${notes.join('\n')}`);
}

function clipboardPng(): Buffer<ArrayBuffer> {
  if (process.platform === 'darwin') return macClipboard();
  if (process.platform === 'win32') return winClipboard();
  return linuxClipboard();
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
    /* The phrase is the Worker's `SESSION_EXPIRED_PHRASE`, pinned from both
       ends by tests/auth.test.ts: auth.ts cannot be imported here, because the
       bin project resolves node16 and src/ imports carry no extensions. */
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
    for (const file of await names(join(versions, version, 'bin'))) {
      if (!file.startsWith('share.')) continue;
      const path = join(versions, version, 'bin', file);
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
    if (!space || (paths.length === 0 && !flags.clip)) {
      die('usage: nt-share put <space> <file|dir ...> | nt-share put <space> --clip');
    }
    const form = new FormData();
    let count = 0;
    // First, so a clipboard holding no image costs no 1Password unlock.
    if (flags.clip) {
      form.append('f', new Blob([clipboardPng()]), flags.name ?? 'clipboard.png');
      count++;
    }
    for (const p of paths) {
      for (const { abs, rel } of await walk(p)) {
        form.append('f', new Blob([await readFile(abs)]), rel);
        count++;
        if (!VIDEO_EXT.test(rel)) continue;
        const poster = await posterFrame(abs);
        if (poster) form.append('f', new Blob([poster]), posterPath(rel));
      }
    }
    if (count === 0) die('nothing to upload');
    const q = new URLSearchParams();
    if (flags.ttl) q.set('ttl', flags.ttl);
    if (flags.tier) q.set('tier', flags.tier);
    if (flags['sign-ttl']) q.set('sign', flags['sign-ttl']);
    // The server owns the name list and 400s an unknown one, so no copy here.
    if (flags.transform) q.set('transform', flags.transform);
    const made = fields(await upload(
      `/up/${space}${q.size ? `?${q}` : ''}`, { method: 'POST', body: form },
    ));
    console.log(textAt(made, 'signedUrl') ?? required(made, 'url'));
    // stderr, labeled: stdout is the links you hand over, so a pipe never
    // grabs the write credential. `nt-share admin` re-opens it after 5 min.
    const adminUrl = textAt(made, 'adminUrl');
    if (adminUrl) console.error(`admin (5 min): ${adminUrl}`);
    break;
  }
  case 'sign': {
    const [path] = rest;
    if (!path) die('usage: nt-share sign <space>/<hash>');
    const signed = fields(await api('/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, ttl: flags.ttl }),
    }, vaultToken()));
    console.log(required(signed, 'url'));
    break;
  }
  case 'admin': {
    const [path] = rest;
    if (!path?.includes('/')) die('usage: nt-share admin <space>/<hash>');
    const made = fields(await api(`/${path.replace(/\/$/, '')}/admin`, { method: 'POST' }, vaultToken()));
    console.log(required(made, 'url'));
    break;
  }
  /* The verify verb. Mints its own admin credential rather than asking for a
     link, so a model can run it without a human pasting one; the status route
     is pure reads, so checking never costs a browser minute. One GET - a
     pending render reads as pending and the caller reruns. */
  case 'check': {
    const [path] = rest;
    if (!path?.includes('/')) die('usage: nt-share check <space>/<hash> [--json]');
    const artifact = path.replace(/\/$/, '');
    const token = vaultToken();
    const link = fields(await api(`/${artifact}/admin`, { method: 'POST' }, token));
    const c = new URL(required(link, 'url')).searchParams.get('c')
      ?? die('the admin link carried no ?c=');
    const body = await api(`/${artifact}/status?c=${encodeURIComponent(c)}`, {}, token);
    if (flags.json) {
      console.log(body.trim());
      break;
    }
    const sources = decodeStatus(body);
    if (sources.length === 0) console.error('no renderable source in this artifact');
    const width = Math.max(0, ...sources.map((s) => s.path.length));
    for (const s of sources) console.log(`${s.path.padEnd(width)}  ${verdict(s)}`);
    // Exit 1 so a loop can branch on a clipped deck without parsing the report.
    if (sources.some((s) => s.overflow && s.overflow.length > 0)) {
      console.error('a slide clips: fix the source, then rm and put a fresh deck - never edit in place');
      process.exit(1);
    }
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
    die('commands: install, put, sign, admin, check, ls, rm; see https://share.notambourine.com/llms.txt');
}
