import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Spawns the real CLI, so the Windows CI leg proves the cache path and the
   path handling work off-POSIX, not just that they parse.
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
