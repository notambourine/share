import { describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Spawns the real CLI, so the Windows CI leg proves the path handling works
   off-POSIX, not just that it parses.
   PATH='' is how a case proves a code path never shells out to `op`. */

/* Each case spawns a node process, and windows-latest has crossed vitest's 5s
   default. spawnSync's own timeout below stays the real hang stop. */
const SPAWN_TIMEOUT = process.platform === 'win32' ? 60_000 : 15_000;
vi.setConfig({ testTimeout: SPAWN_TIMEOUT + 5_000 });

const BIN = join(process.cwd(), 'bin', 'share.ts');
const DEAD = 'http://127.0.0.1:9'; // unroutable: reaching a fetch error means the token resolved

function run(args: string[], env: Record<string, string>) {
  const clean = { ...process.env, ...env };
  if (!('SHARE_TOKEN' in env)) delete clean.SHARE_TOKEN;
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: clean,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function aFile() {
  const path = join(mkdtempSync(join(tmpdir(), 'share-src-')), 'note.md');
  writeFileSync(path, '# hi\n');
  return path;
}

describe('credential resolution', () => {
  it('a raw SHARE_TOKEN skips 1Password entirely', () => {
    const { code, out } = run(['put', 'acme', aFile()], {
      SHARE_URL: DEAD, SHARE_TOKEN: 'raw-token', PATH: '',
    });
    expect(code).not.toBe(0);
    expect(out).toContain('fetch failed');
    expect(out).not.toContain('1Password');
  });

  it('names the vault path it could not read', () => {
    const { code, out } = run(['admin', 'acme/Ab3dEf6hIj9k'], {
      PATH: '', SHARE_TOKEN_REF: 'op://Vault/item/field',
    });
    expect(code).toBe(1);
    expect(out).toContain('1Password CLI not found');
  });

  it('needs a <space>/<hash> for admin, not a bare space', () => {
    const { code, out } = run(['admin', 'acme'], { PATH: '' });
    expect(code).toBe(1);
    expect(out).toContain('usage: nt-share admin <space>/<hash>');
  });

  it('needs a path for put, and never unlocks the vault to say so', () => {
    const { code, out } = run(['put', 'acme'], { PATH: '' });
    expect(code).toBe(1);
    expect(out).toContain('usage: nt-share put');
    expect(out).not.toContain('1Password');
  });

  /* The verbs that are gone stay gone: a caller reaching for one gets the list
     rather than a stack trace or a silent no-op. */
  it('names the two verbs when asked for a retired one', () => {
    for (const verb of ['sign', 'check', 'fix', 'ls', 'rm']) {
      const { code, out } = run([verb, 'acme/Ab3dEf6hIj9k'], { PATH: '' });
      expect([verb, code]).toEqual([verb, 1]);
      expect(out).toContain('commands: install, put, admin');
    }
  });
});

describe('install', () => {
  it('writes a resolver plus a wrapper for each shell', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'share-bin-')), 'bin');
    const { code, out } = run(['install', '--dir', dir], {});
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
    run(['install', '--dir', dir], {});
    const r = spawnSync(process.execPath, [join(dir, 'nt-share.mjs'), 'put'], {
      env: { ...process.env, SHARE_URL: DEAD, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT,
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
    // `put` with no space prints the CLI's own usage, reached only through the import.
    expect(resolve(pluginHome())).toContain('usage: nt-share put');
  });

  it('prefers the newest plugin copy, by version and not by name', () => {
    // The whole reason this resolver is not a shell pipeline: every string sort
    // ranks 0.9.0 over 0.10.0, and `sort -V` has no cmd.exe equivalent.
    expect(resolve(pluginHome('0.9.0', '0.10.0'))).toContain('CLI 0.10.0');
  });
});

/* A stub Worker, because what `put` prints is what a person hands over: stdout
   carries the one public URL and the working-page link stays on stderr, so a
   pipe can never grab the write credential. spawn, not spawnSync, since a
   blocked event loop could never answer the request under test. */
describe('put', () => {
  interface Seen {
    asked: string[];
    files: string[];
  }

  /** What the stub Worker answers with, as the upload route spells it. */
  interface StubUpload {
    url?: string;
    hash: string;
    files?: string[];
    adminUrl?: string;
    adminExp?: number;
  }

  async function put(args: string[], answer: StubUpload) {
    const seen: Seen = { asked: [], files: [] };
    const server = createServer((req, res) => {
      seen.asked.push(`${req.method} ${req.url}`);
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        for (const m of body.matchAll(/filename="([^"]+)"/g)) seen.files.push(m[1]);
        res.setHeader('content-type', 'application/json');
        res.statusCode = 201;
        res.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    /* SAFETY: address() is a string only for a unix socket; this one listened
       on a TCP port, and it is listening because the callback above fired. */
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(process.execPath, [BIN, 'put', 'qa', ...args], {
        env: {
          ...process.env,
          SHARE_URL: `http://127.0.0.1:${port}`,
          SHARE_TOKEN: 'raw-token',
          PATH: '',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
      const code = await new Promise<number | null>((ok) => child.on('close', ok));
      return { code, stdout, stderr, seen };
    } finally {
      server.close();
    }
  }

  const ANSWER = {
    url: 'https://share.example/qa/abc/note.md',
    hash: 'abc',
    files: ['note.md'],
    adminUrl: 'https://share.example/qa/abc/?c=minted.1.tok',
    adminExp: 0,
  };

  it('one POST, the public URL on stdout and the working page on stderr', async () => {
    const { code, stdout, stderr, seen } = await put([aFile()], ANSWER);
    expect(code).toBe(0);
    expect(seen.asked).toEqual(['POST /up/qa']);
    expect(seen.files).toEqual(['note.md']);
    expect(stdout.trim()).toBe(ANSWER.url);
    expect(stdout).not.toContain('?c=');
    expect(stderr).toContain('working page (5 min)');
  });

  it('passes a ttl through and nothing else', async () => {
    const { seen } = await put([aFile(), '--ttl', '7d'], ANSWER);
    expect(seen.asked).toEqual(['POST /up/qa?ttl=7d']);
  });

  it('dies rather than printing undefined when the answer carries no url', async () => {
    const { code, stderr } = await put([aFile()], { hash: 'abc' });
    expect(code).toBe(1);
    expect(stderr).toContain('the server answered without a url');
  });

  it('keeps a folder\'s relative paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'share-dir-'));
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'index.html'), '<p>hi</p>');
    writeFileSync(join(root, 'sub', 'style.css'), 'body{}');
    writeFileSync(join(root, '.hidden'), 'skip me');
    const { seen } = await put([root], ANSWER);
    expect(seen.files.sort()).toEqual(['index.html', 'sub/style.css']);
  });
});
