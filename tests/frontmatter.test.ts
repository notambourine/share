import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontMatter } from '../src/lib/exportPath';

/* public/render.js has no build step, so its stripFront is a hand copy of
   splitFrontMatter. This file is the pin: both run every fixture, and the
   extraction fails loudly if the client copy is renamed or reshaped. */

function clientStrip(): (text: string) => string {
  const src = readFileSync(join(process.cwd(), 'public', 'render.js'), 'utf8');
  const m = /function stripFront\(text\) \{[\s\S]*?\n {2}\}/.exec(src);
  if (!m) throw new Error('stripFront not found in public/render.js');
  /* SAFETY: the extracted source is the function under test; it takes and
     returns a string by construction, and a lie here fails the fixtures. */
  return new Function(`${m[0]}; return stripFront;`)() as (text: string) => string;
}

const CASES: [string, string][] = [
  ['plain doc', '# Title\n\nbody\n'],
  ['front matter closed by ---', '---\nmarp: true\ntheme: nt\n---\n# Title\n\nbody\n'],
  ['front matter closed by ...', '---\ntitle: x\n...\n# Title\n'],
  ['crlf line endings', '---\r\nmarp: true\r\n---\r\n# Title\r\n'],
  ['setext heading is not front matter', 'Title\n---\n\nbody\n'],
  ['unterminated open fence', '---\ntitle: x\n'],
  ['slide breaks survive the strip', '---\nmarp: true\n---\n# One\n\n---\n\n# Two\n'],
  ['empty file', ''],
];

describe('front matter: client strip matches the server split', () => {
  const strip = clientStrip();
  for (const [name, md] of CASES) {
    it(name, () => {
      expect(strip(md)).toBe(splitFrontMatter(md).body);
    });
  }

  it('a fronted document body starts at the content, not an hr', () => {
    expect(splitFrontMatter('---\nmarp: true\n---\n# Title\n').body).toBe('# Title\n');
  });
});
