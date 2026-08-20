import { describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now } from '../src/lib/clock';

/* Spawns the real CLI, so the Windows CI leg proves the cache path and the
   path handling work off-POSIX, not just that they parse.
   PATH='' is how a case proves a code path never shells out to `op`. */

/* Each case spawns a node process, and windows-latest has crossed vitest's 5s
   default. spawnSync's own 15s timeout below stays the real hang stop. */
vi.setConfig({ testTimeout: 20_000 });

const BIN = join(process.cwd(), 'bin', 'share.ts');
const DEAD = 'http://127.0.0.1:9'; // unroutable: reaching a fetch error means the token resolved

function run(args: string[], env: Record<string, string>) {
  const clean = { ...process.env, ...env };
  if (!('SHARE_TOKEN' in env)) delete clean.SHARE_TOKEN;
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: clean,
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function cacheDir(session?: { token: string; name: string; expiresAt: number }) {
  const root = mkdtempSync(join(tmpdir(), 'share-cli-'));
  if (session) {
    const dir = join(root, 'notambourine-share');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify(session));
  }
  return root;
}

function aFile() {
  const path = join(mkdtempSync(join(tmpdir(), 'share-src-')), 'note.md');
  writeFileSync(path, '# hi\n');
  return path;
}

const live = () => ({ token: 'tom.v1.9.x', name: 'tom', expiresAt: now() + 300 });

describe('credential resolution', () => {
  it('put runs off the cached session without touching 1Password', () => {
    const { code, out } = run(['put', 'acme', aFile()], {
      XDG_CACHE_HOME: cacheDir(live()), SHARE_URL: DEAD, PATH: '',
    });
    expect(code).not.toBe(0);
    expect(out).toContain('fetch failed');
    expect(out).not.toContain('1Password');
  });

  it('a raw SHARE_TOKEN skips 1Password for a vault verb', () => {
    const { code, out } = run(['ls', 'acme'], {
      XDG_CACHE_HOME: cacheDir(), SHARE_URL: DEAD, SHARE_TOKEN: 'raw-token', PATH: '',
    });
    expect(code).not.toBe(0);
    expect(out).toContain('fetch failed');
    expect(out).not.toContain('1Password');
  });

  it('an expired cache falls through to the vault, and says so when op is missing', () => {
    const stale = { token: 'tom.v1.1.x', name: 'tom', expiresAt: 1 };
    const { code, out } = run(['put', 'acme', aFile()], {
      XDG_CACHE_HOME: cacheDir(stale), SHARE_URL: DEAD, PATH: '',
    });
    expect(code).toBe(1);
    expect(out).toContain('1Password CLI not found');
  });

  it('names the vault path it could not read', () => {
    const { out } = run(['ls', 'acme'], {
      XDG_CACHE_HOME: cacheDir(), PATH: '', SHARE_TOKEN_REF: 'op://Vault/item/field',
    });
    expect(out).toContain('1Password CLI not found');
  });
});

describe('clipboard', () => {
  /* PATH stays intact here - the read is a shell-out per platform, and every CI
     runner's clipboard is empty, so all three legs take the no-image path. The
     `fetch failed` branch is the developer who does have an image copied.
     A live session either way, so a run can never raise a 1Password prompt. */
  it('--clip needs no path and fails clean with an empty clipboard', () => {
    const { code, out } = run(['put', 'acme', '--clip'], {
      XDG_CACHE_HOME: cacheDir(live()), SHARE_URL: DEAD,
    });
    expect(code).toBe(1);
    expect(out).toMatch(/clipboard|fetch failed/);
    expect(out).not.toContain('usage:');
  });

  it('--clip takes no value from the flag after it', () => {
    const { out } = run(['put', 'acme', '--clip', '--ttl', '7d'], {
      XDG_CACHE_HOME: cacheDir(live()), SHARE_URL: DEAD,
    });
    expect(out).not.toContain('usage:');
  });
});

describe('install', () => {
  it('writes a resolver plus a wrapper for each shell', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'share-bin-')), 'bin');
    const { code, out } = run(['install', '--dir', dir], { XDG_CACHE_HOME: cacheDir() });
    expect(code).toBe(0);
    expect(out).toContain(join(dir, 'nt-share'));

    // Both, on both platforms: one home directory can be shared with WSL, and
    // cmd.exe cannot run the sh wrapper whatever its contents.
    expect(readFileSync(join(dir, 'nt-share'), 'utf8')).toContain('nt-share.mjs');
    const bat = readFileSync(join(dir, 'nt-share.cmd'), 'utf8');
    expect(bat).toContain('%~dp0nt-share.mjs');
    expect(bat).toContain('\r\n'); // cmd.exe still wants CRLF

    const resolver = readFileSync(join(dir, 'nt-share.mjs'), 'utf8');
    expect(resolver).toContain("join(root, market, 'nt-share')");
    // JSON.stringify, not the raw path: that is the quoting the resolver embeds,
    // and on Windows a backslash path only matches once it is escaped.
    expect(resolver).toContain(JSON.stringify(BIN)); // fallback when no plugin copy is installed
    // NTFS carries no exec bit, so node reports mode 0o666 there whatever the
    // chmod asked for. The bit is a POSIX claim; assert it where it exists.
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'nt-share')).mode & 0o111).toBeTruthy();
    }
  });

  /* The resolver is generated source, so nothing typechecks or lints it. Running
     it is what proves it parses and that the import actually lands. */
  /* Always an explicit home, so the plugin cache under test is the empty one or
     the built one, never whatever this machine happens to have installed.
     homedir() reads HOME off POSIX and USERPROFILE on Windows, so set both. */
  function resolve(home: string) {
    const dir = join(mkdtempSync(join(tmpdir(), 'share-bin-')), 'bin');
    run(['install', '--dir', dir], { XDG_CACHE_HOME: cacheDir() });
    const r = spawnSync(process.execPath, [join(dir, 'nt-share.mjs'), 'ls'], {
      env: {
        ...process.env,
        XDG_CACHE_HOME: cacheDir(), SHARE_URL: DEAD, HOME: home, USERPROFILE: home,
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    return `${r.stdout}${r.stderr}`;
  }

  function pluginHome(...versions: string[]) {
    const home = mkdtempSync(join(tmpdir(), 'share-home-'));
    for (const version of versions) {
      const bin = join(home, '.claude', 'plugins', 'cache', 'mkt', 'nt-share', version, 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'share.ts'), `console.log('CLI ${version}');\n`);
    }
    return home;
  }

  it('falls back to the CLI that installed it', () => {
    // `ls` with no space prints the CLI's own usage, reached only through the import.
    expect(resolve(pluginHome())).toContain('usage: nt-share ls <space>');
  });

  it('prefers the newest plugin copy, by version and not by name', () => {
    // The whole reason this resolver is not a shell pipeline: every string sort
    // ranks 0.9.0 over 0.10.0, and `sort -V` has no cmd.exe equivalent.
    expect(resolve(pluginHome('0.9.0', '0.10.0'))).toContain('CLI 0.10.0');
  });
});

/* A stub Worker, because `check` is two calls whose second depends on the
   first: the report is only right if the CLI pulls `?c=` out of the minted
   admin link and spends it on the status route. spawn, not spawnSync, since a
   blocked event loop could never answer the request under test. */
describe('check', () => {
  /** The status route's answer, as the stub hands it back. */
  interface StubStatus {
    sources: {
      path: string;
      rendered: string[];
      check: { slides: number; overflow: number[] } | null;
    }[];
  }

  function stub(status: StubStatus) {
    const asked: string[] = [];
    const server = createServer((req, res) => {
      asked.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/admin')) {
        res.end(JSON.stringify({ url: 'https://share.example/qa/abc/?c=minted.1.tok', exp: 0 }));
        return;
      }
      res.end(JSON.stringify(status));
    });
    return { server, asked };
  }

  async function check(status: StubStatus, args: string[] = []) {
    const { server, asked } = stub(status);
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    /* SAFETY: address() is a string only for a unix socket; this one listened
       on a TCP port, and it is listening because the callback above fired. */
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(process.execPath, [BIN, 'check', 'qa/abc', ...args], {
        env: {
          ...process.env,
          SHARE_URL: `http://127.0.0.1:${port}`,
          SHARE_TOKEN: 'raw-token',
          XDG_CACHE_HOME: cacheDir(),
          PATH: '',
        },
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
      const code = await new Promise<number | null>((ok) => child.on('close', ok));
      return { code, out, asked };
    } finally {
      server.close();
    }
  }

  const deck = {
    sources: [
      { path: 'deck.md', rendered: ['slides.html', 'slides.pdf'], check: { slides: 12, overflow: [7] } },
      { path: 'notes.md', rendered: ['doc.html', 'doc.pdf'], check: null },
      { path: 'page.html', rendered: [], check: null },
    ],
  };

  it('spends the minted ?c= on the status route and reports each source', async () => {
    const { code, out, asked } = await check(deck);
    expect(asked[0]).toBe('POST /qa/abc/admin');
    expect(asked[1]).toBe('GET /qa/abc/status?c=minted.1.tok');
    expect(out).toContain('12 slides, overflow on 7');
    expect(out).toContain('page.html  (pending)');
    expect(out).toContain('deck.md    slides.html'); // padded to the longest path
    expect(code).toBe(1); // a clipped slide is a failure a loop can branch on
    // The report names the repair verb, so the caller never has to guess it.
    expect(out).toContain('nt-share fix qa/abc');
  });

  it('exits 0 when nothing clips', async () => {
    const clean = {
      sources: [{ path: 'deck.md', rendered: ['slides.pdf'], check: { slides: 3, overflow: [] } }],
    };
    const { code, out } = await check(clean);
    expect(out).toContain('3 slides, ok');
    expect(code).toBe(0);
  });

  it('exits 2 on a markdown source that has not rendered, so pending never reads as a pass', async () => {
    const { code, out } = await check({ sources: [{ path: 'deck.md', rendered: [], check: null }] });
    expect(out).toContain('(pending)');
    expect(code).toBe(2);
  });

  it('exits 0 on an html source, which carries no renders by nature', async () => {
    const { code } = await check({ sources: [{ path: 'page.html', rendered: [], check: null }] });
    expect(code).toBe(0);
  });

  it('--json prints the server body and never the report', async () => {
    const { code, out } = await check(deck, ['--json']);
    expect(JSON.parse(out)).toEqual(deck);
    expect(code).toBe(0); // the caller reads the verdict itself
  });

  it('needs a <space>/<hash>, not a bare space', () => {
    const { code, out } = run(['check', 'qa'], { XDG_CACHE_HOME: cacheDir(), PATH: '' });
    expect(code).toBe(1);
    expect(out).toContain('usage: nt-share check <space>/<hash>');
  });
});

describe('fix', () => {
  interface Seen {
    asked: string[];
    upload: { query: string; files: string[] } | null;
  }

  /** The status route's answer for a repair: the tier and the file list the fix
      rebuilds from, plus the check verdict that names what clips. */
  interface FixStatus {
    tier: string;
    files: string[];
    sources: {
      path: string;
      rendered: string[];
      check: { slides: number; overflow: number[] } | null;
    }[];
  }

  /* One stub for the whole repair round trip: mint the admin credential, read
     the status, mint a view link, GET each file back, and re-upload. */
  function stubFix(status: FixStatus) {
    const seen: Seen = { asked: [], upload: null };
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      seen.asked.push(`${req.method} ${url}`);
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/admin')) {
        res.end(JSON.stringify({ url: 'https://share.example/qa/abc/?c=minted.1.tok', exp: 0 }));
        return;
      }
      if (url.startsWith('/qa/abc/status')) {
        res.end(JSON.stringify(status));
        return;
      }
      if (url === '/sign') {
        /* SAFETY: address() is a string only for a unix socket; the caller
           listened this server on a TCP port before spawning the CLI. */
        const port = (server.address() as AddressInfo).port;
        res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/qa/abc/k/v2.1.tok/`, exp: 0, tier: 'signed' }));
        return;
      }
      if (url.includes('?raw')) {
        res.setHeader('content-type', 'text/plain');
        res.end('# a deck that clips\n');
        return;
      }
      if (url.startsWith('/up/qa')) {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          seen.upload = {
            query: url.slice(url.indexOf('?') + 1),
            files: [...body.matchAll(/filename="([^"]+)"/g)].map((m) => m[1]),
          };
          res.end(JSON.stringify({ url: 'https://share.example/qa/new/', hash: 'new', tier: 'signed' }));
        });
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    return { server, seen };
  }

  async function fix(status: FixStatus, args: string[] = []) {
    const { server, seen } = stubFix(status);
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    /* SAFETY: address() is a string only for a unix socket; this one listened
       on a TCP port, and it is listening because the callback above fired. */
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(process.execPath, [BIN, 'fix', 'qa/abc', ...args], {
        env: {
          ...process.env,
          SHARE_URL: `http://127.0.0.1:${port}`,
          SHARE_TOKEN: 'raw-token',
          // A live session, because the re-upload runs on one like any put.
          XDG_CACHE_HOME: cacheDir(live()),
          PATH: '',
        },
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
      const code = await new Promise<number | null>((ok) => child.on('close', ok));
      return { code, out, seen };
    } finally {
      server.close();
    }
  }

  const clipping = {
    tier: 'signed',
    files: ['deck.md', 'chart.png'],
    sources: [{ path: 'deck.md', rendered: ['slides.pdf'], check: { slides: 8, overflow: [3, 5] } }],
  };

  it('sends the clipped slide numbers and every file, and lands a new artifact', async () => {
    const { code, out, seen } = await fix(clipping);
    expect(code).toBe(0);
    const query = new URLSearchParams(seen.upload?.query ?? '');
    expect(query.get('transform')).toBe('fix');
    expect(query.get('slides')).toBe('3,5');
    // The source's tier carries over, or a signed deck would be repaired open.
    expect(query.get('tier')).toBe('signed');
    /* Every file, not just the deck: this is a fresh upload, so an image left
       behind here would be an image the repaired deck no longer has. */
    expect(seen.upload?.files).toEqual(['deck.md', 'chart.png']);
    expect(out).toContain('https://share.example/qa/new/');
    expect(out).toContain('trimmed slides 3, 5 of deck.md');
    // Immutability: the fix never touches the artifact it read.
    expect(seen.asked.some((a) => a.startsWith('DELETE'))).toBe(false);
  });

  it('--tier overrides the source tier', async () => {
    const { seen } = await fix(clipping, ['--tier', 'open']);
    expect(new URLSearchParams(seen.upload?.query ?? '').get('tier')).toBe('open');
  });

  it('spends no AI and uploads nothing when nothing clips', async () => {
    const clean = {
      tier: 'open',
      files: ['deck.md'],
      sources: [{ path: 'deck.md', rendered: ['slides.pdf'], check: { slides: 3, overflow: [] } }],
    };
    const { code, out, seen } = await fix(clean);
    expect(code).toBe(0);
    expect(out).toContain('nothing clips');
    expect(seen.upload).toBe(null);
  });

  it('needs a <space>/<hash>, not a bare space', () => {
    const { code, out } = run(['fix', 'qa'], { XDG_CACHE_HOME: cacheDir(), PATH: '' });
    expect(code).toBe(1);
    expect(out).toContain('usage: nt-share fix <space>/<hash>');
  });
});

describe('ls', () => {
  /** One row of the list route's answer, as the stub hands it back. */
  interface StubRow {
    hash: string;
    url: string;
    tier: string;
    files: number;
    bytes: number;
    expired: boolean;
    sources: string[];
  }

  function stubLs(rows: StubRow[]) {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(rows));
    });
    return server;
  }

  /* spawn, not the spawnSync `run` helper: the stub answers on this process's
     event loop, and spawnSync blocks it, so a sync child could only ever time
     out waiting for a reply that cannot be sent. */
  async function ls(rows: StubRow[], args: string[] = []) {
    const server = stubLs(rows);
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    /* SAFETY: address() is a string only for a unix socket; this one listened
       on a TCP port, and it is listening because the callback above fired. */
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(process.execPath, [BIN, 'ls', 'qa', ...args], {
        env: {
          ...process.env,
          SHARE_URL: `http://127.0.0.1:${port}`,
          SHARE_TOKEN: 'raw-token',
          XDG_CACHE_HOME: cacheDir(),
          PATH: '',
        },
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { out += c.toString(); });
      const code = await new Promise<number | null>((ok) => child.on('close', ok));
      return { code, out };
    } finally {
      server.close();
    }
  }

  const rows = [{
    hash: 'abc',
    url: 'https://share.example/qa/abc/',
    tier: 'open',
    files: 1,
    bytes: 2048,
    expired: false,
    sources: ['deck.md'],
  }];

  it('names every spelling a markdown source answers to', async () => {
    const { code, out } = await ls(rows);
    expect(code).toBe(0);
    expect(out).toContain('https://share.example/qa/abc/');
    expect(out).toContain('1 file, 2.0 KB');
    /* The four render spellings plus the source, so a recipient can pick a mode
       rather than guess what a bare `.md` sniffs to. */
    expect(out).toContain('deck.slides.html');
    expect(out).toContain('deck.doc.html');
    expect(out).toContain('deck.slides.pdf');
    expect(out).toContain('deck.doc.pdf');
    expect(out).toContain('deck.txt');
  });

  it('marks an expired artifact', async () => {
    const { out } = await ls([{ ...rows[0], expired: true }]);
    expect(out).toContain('EXPIRED');
  });

  it('--json prints the server body untouched', async () => {
    const { out } = await ls(rows, ['--json']);
    expect(JSON.parse(out)).toEqual(rows);
  });
});
