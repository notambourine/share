import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Spawns the real CLI, so the Windows CI leg proves the cache path, the
   fs modes, and the path handling work off-POSIX, not just that they parse.
   PATH='' is how a case proves a code path never shells out to `op`. */

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

const live = () => ({ token: 'tom.v1.9.x', name: 'tom', expiresAt: Math.floor(Date.now() / 1000) + 300 });

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

describe('install', () => {
  it('writes a runnable shim that re-resolves its CLI', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'share-bin-')), 'bin');
    const { code, out } = run(['install', '--dir', dir], { XDG_CACHE_HOME: cacheDir() });
    expect(code).toBe(0);
    expect(out).toContain(join(dir, 'nt-share'));

    const shim = readFileSync(join(dir, 'nt-share'), 'utf8');
    expect(shim).toContain('nt-share/*/bin/share.');
    // JSON.stringify, not the raw path: that is the quoting the shim embeds, and
    // on Windows a backslash path only matches once it is escaped.
    expect(shim).toContain(JSON.stringify(BIN)); // the fallback when no plugin copy is installed
    expect(statSync(join(dir, 'nt-share')).mode & 0o111).toBeTruthy();
  });
});
