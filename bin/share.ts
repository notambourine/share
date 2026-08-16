#!/usr/bin/env node
/* nt-share: CLI for share.notambourine.com. One command per job, no plumbing.

   Every verb resolves its own credential: an upload uses the cached session
   token, mints one from 1Password when there is none, and re-mints once if the
   cached one died mid-run. The vault token is read straight into this process
   and never crosses a shell, so no `op run` prefix and nothing to echo.

   nt-share install                                     (put nt-share on PATH)
   nt-share put <space> <file|dir ...> [--tier signed] [--ttl 90d|forever]
                                       [--ttl-idle 7d] [--sign-ttl 30d] [--short]
   nt-share put <space> --clip [--name shot.png]        (the image on the clipboard)
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
import { Buffer } from 'node:buffer';
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

/** A flag that takes no value; anything else here would eat the next argument. */
const BARE = new Set(['short', 'print', 'clip']);

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
