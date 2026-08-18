import { describe, expect, it } from 'vitest';
import { splitFrontMatter } from '../src/lib/exportPath';

/* These fixtures used to prove that public/render.js's hand-copied `stripFront`
   agreed with this function - two implementations, and the test could only say
   they matched, never that either was right. src/client/ imports the real one
   now, so the fixtures assert the behavior itself. */

const CASES: [name: string, markdown: string, body: string][] = [
  ['plain doc', '# Title\n\nbody\n', '# Title\n\nbody\n'],
  ['front matter closed by ---', '---\nmarp: true\ntheme: nt\n---\n# Title\n\nbody\n', '# Title\n\nbody\n'],
  ['front matter closed by ...', '---\ntitle: x\n...\n# Title\n', '# Title\n'],
  ['crlf line endings', '---\r\nmarp: true\r\n---\r\n# Title\r\n', '# Title\r\n'],
  // A setext h2 opens with text, so the `---` under it is a rule, not a fence.
  ['setext heading is not front matter', 'Title\n---\n\nbody\n', 'Title\n---\n\nbody\n'],
  ['unterminated open fence', '---\ntitle: x\n', '---\ntitle: x\n'],
  ['slide breaks survive the strip', '---\nmarp: true\n---\n# One\n\n---\n\n# Two\n', '# One\n\n---\n\n# Two\n'],
  ['empty file', '', ''],
];

describe('splitFrontMatter', () => {
  for (const [name, markdown, body] of CASES) {
    it(`takes the body from a ${name}`, () => {
      expect(splitFrontMatter(markdown).body).toBe(body);
    });
  }

  it('hands back the front matter without its fences', () => {
    expect(splitFrontMatter('---\nmarp: true\ntheme: nt\n---\n# Title\n').front)
      .toBe('marp: true\ntheme: nt');
  });

  it('reports no front matter when there is none to report', () => {
    expect(splitFrontMatter('# Title\n').front).toBe('');
    expect(splitFrontMatter('---\nunterminated\n').front).toBe('');
  });
});
