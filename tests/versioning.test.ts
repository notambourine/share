/**
 * Version stamping and the bare-name alias.
 *
 * A generation lands as `<name>.<epoch>.md` and joins `meta.files`; the bare
 * `<name>.md` and `<name>.pdf` follow whichever stamp is highest, resolved by
 * listing rather than by a stored pointer. Every older stamp keeps its own URL,
 * which is what makes re-generating safe on a link already handed over.
 */

import { describe, expect, it } from 'vitest';
import {
  baseOf, derivedKey, latestStamped, resolveExport, stampOf,
} from '../src/lib/exportPath';
import { now } from '../src/lib/clock';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const NOW = now();
const deckText = (stamp: number) => `---\nmarp: true\n---\n\n# a deck v${stamp}\n`;

describe('stamp parsing', () => {
  it('reads a stamp off a generated name and null off an uploaded one', () => {
    expect(stampOf('deck.1712.md')).toBe(1712);
    expect(stampOf('deck.md')).toBeNull();
    expect(stampOf('deck.1712.png')).toBeNull();
    expect(stampOf('notes.v2.md')).toBeNull();
  });

  it('names the base a stamp hangs off, which is where the alias lands', () => {
    expect(baseOf('ship-summary.1712.md')).toBe('ship-summary');
    expect(baseOf('deck.md')).toBe('deck');
  });
});

describe('highest-epoch selection', () => {
  it('takes the highest epoch, whatever order the list holds', () => {
    const paths = ['deck.1000.md', 'deck.3000.md', 'deck.2000.md', 'notes.md'];
    expect(latestStamped(paths, 'deck')).toBe('deck.3000.md');
    expect(latestStamped([...paths].reverse(), 'deck')).toBe('deck.3000.md');
  });

  it('answers null when a share holds no stamp under that base', () => {
    expect(latestStamped(['deck.md', 'notes.md'], 'deck')).toBeNull();
    expect(latestStamped([], 'deck')).toBeNull();
    expect(latestStamped(['deck.1000.md'], 'agenda')).toBeNull();
  });

  it('resolves a bare .pdf onto the newest generation, each stamp keeping its own', () => {
    const paths = ['notes.txt', 'deck.1000.md', 'deck.2000.md'];
    expect(resolveExport(paths, 'deck.pdf')).toEqual({ source: 'deck.2000.md', format: 'pdf' });
    expect(resolveExport(paths, 'deck.1000.pdf')).toEqual({ source: 'deck.1000.md', format: 'pdf' });
  });
});

function seededEnv(stamps: number[]): TestEnv {
  const files = stamps.map((s) => ({
    path: `deck.${s}.md`, size: deckText(s).length, type: 'text/markdown; charset=utf-8',
  }));
  const objects = new Map(stamps.map((s) => [`${SPACE}/${HASH}/f/deck.${s}.md`, deckText(s)]));
  return testEnv({
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: JSON.stringify({
        space: SPACE, hash: HASH, uploader: 'tom', createdAt: NOW, expiresAt: null, files,
      }),
      ...Object.fromEntries(objects),
    },
  });
}

const ask = (env: TestEnv, path: string, accept = 'text/html') =>
  fetchWorker(env, new Request(`https://share.test/${SPACE}/${HASH}/${path}`, { headers: { accept } }));

describe('the alias through the router', () => {
  it('a bare .md serves the highest stamp with three present', async () => {
    const env = seededEnv([1000, 3000, 2000]);
    const html = await (await ask(env, 'deck.md')).text();
    expect(html).toContain('a deck v3000');
    expect(html).not.toContain('a deck v2000');
  });

  it('an older stamp still serves its own bytes', async () => {
    const env = seededEnv([1000, 3000]);
    expect(await (await ask(env, 'deck.1000.md', '*/*')).text()).toContain('a deck v1000');
  });

  it('a single-version share resolves its one stamp', async () => {
    const env = seededEnv([1712]);
    expect((await ask(env, 'deck.md')).status).toBe(200);
  });

  it('404s a bare name no stamp answers', async () => {
    const env = seededEnv([1712]);
    expect((await ask(env, 'agenda.md')).status).toBe(404);
  });

  /* Each version renders to its own key, so the newest PDF is never the older
     version's bytes under a bare name. */
  it('serves the newest version cached PDF and leaves the older one alone', async () => {
    const env = seededEnv([1000, 2000]);
    env.BUCKET.objects.set(derivedKey(SPACE, HASH, 'deck.1000.md', 'slides', 'pdf'), 'OLD');
    env.BUCKET.objects.set(derivedKey(SPACE, HASH, 'deck.2000.md', 'slides', 'pdf'), 'NEW');
    expect(await (await ask(env, 'deck.pdf', '*/*')).text()).toBe('NEW');
    expect(await (await ask(env, 'deck.1000.pdf', '*/*')).text()).toBe('OLD');
  });
});
