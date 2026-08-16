import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Spawns the real CLI, so the Windows CI leg proves the cache path, the
   fs modes, and the path handling work off-POSIX, not just that they parse. */

const BIN = join(process.cwd(), 'bin', 'share.mjs');

function run(args: string[], env: Record<string, string>) {
  const clean = { ...process.env, ...env };
  delete clean.SHARE_TOKEN;
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

describe('share CLI token resolution', () => {
  it('dies with the mint command when no env and no cache', () => {
    const { code, out } = run(['ls', 'acme'], { XDG_CACHE_HOME: cacheDir() });
    expect(code).toBe(1);
    expect(out).toContain('share session');
  });

  it('treats an expired cache as no session', () => {
    const root = cacheDir({ token: 'tom.v1.1.x', name: 'tom', expiresAt: 1 });
    const { code, out } = run(['ls', 'acme'], { XDG_CACHE_HOME: root });
    expect(code).toBe(1);
    expect(out).toContain('no live session');
  });

  it('a live cache gets past the token gate to the network', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const root = cacheDir({ token: 'tom.v1.9.x', name: 'tom', expiresAt: exp });
    // Unroutable host: reaching a fetch failure proves the token resolved.
    const { code, out } = run(['ls', 'acme'], {
      XDG_CACHE_HOME: root, SHARE_URL: 'http://127.0.0.1:9',
    });
    expect(code).not.toBe(0);
    expect(out).not.toContain('no live session');
    expect(out).not.toContain('SHARE_TOKEN is unset');
  });

  it('session refuses to mint without the vault token', () => {
    const { code, out } = run(['session'], { XDG_CACHE_HOME: cacheDir() });
    expect(code).toBe(1);
    expect(out).toContain('vault token');
  });
});
