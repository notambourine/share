import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION, parseExportPath, resolveExport, derivedKey, checkKey, sniffDeck,
  formatsFor, stemOf,
  derivedPrefix, parseDerivedKey, parseCheckKey,
} from '../src/lib/exportPath';

describe('parseExportPath', () => {
  it('reads the two spellings and nothing else', () => {
    expect(parseExportPath('deck.pdf')).toEqual({ base: 'deck', format: 'pdf' });
    expect(parseExportPath('page.png')).toEqual({ base: 'page', format: 'png' });
    expect(parseExportPath('deck.slides.pdf')).toEqual({ base: 'deck.slides', format: 'pdf' });
  });

  it('keeps nested paths intact', () => {
    expect(parseExportPath('docs/q3/deck.pdf')).toEqual({ base: 'docs/q3/deck', format: 'pdf' });
  });

  it('rejects a bare suffix and anything unsuffixed', () => {
    expect(parseExportPath('.pdf')).toBeNull();
    expect(parseExportPath('deck.md')).toBeNull();
  });
});

describe('resolveExport', () => {
  const files = ['deck.md', 'notes.markdown', 'report.pdf', 'shot.png'];

  it('resolves a suffix onto the markdown source', () => {
    expect(resolveExport(files, 'deck.pdf')).toEqual({ source: 'deck.md', format: 'pdf' });
    expect(resolveExport(files, 'notes.pdf')?.source).toBe('notes.markdown');
  });

  /* The suffix grammar is gone: deck-vs-document comes from the content, so a
     spelling that used to pin the mode is now just a base that was never
     uploaded. */
  it('the mode-pinning spellings are gone, no shim', () => {
    expect(resolveExport(files, 'deck.slides.pdf')).toBeNull();
    expect(resolveExport(files, 'deck.doc.pdf')).toBeNull();
    expect(resolveExport(files, 'deck.slides.html')).toBeNull();
    expect(resolveExport(files, 'deck.txt')).toBeNull();
    expect(resolveExport(files, 'deck.md.pdf')).toBeNull();
  });

  /* R12 says fail loudly rather than mangle; silently re-rendering over a real
     upload would be the quiet version of the same mistake. */
  it('lets a real uploaded file win its own name', () => {
    expect(resolveExport(files, 'report.pdf')).toBeNull();
    expect(resolveExport([...files, 'deck.pdf'], 'deck.pdf')).toBeNull();
  });

  it('.md beats .markdown when one upload holds both spellings', () => {
    expect(resolveExport(['a.markdown', 'a.md'], 'a.pdf')?.source).toBe('a.md');
    expect(resolveExport(['b.MD'], 'b.pdf')?.source).toBe('b.MD');
  });

  it('refuses a base that was never uploaded as a source', () => {
    expect(resolveExport(files, 'shot.pdf')).toBeNull();
    expect(resolveExport(files, 'missing.pdf')).toBeNull();
    // shot.png is a real upload, never an export of itself.
    expect(resolveExport(files, 'shot.png')).toBeNull();
  });

  it('falls back to an .html source, which takes both spellings', () => {
    const page = ['page.html', 'shot.png'];
    expect(resolveExport(page, 'page.pdf')).toEqual({ source: 'page.html', format: 'pdf' });
    expect(resolveExport(page, 'page.png')).toEqual({ source: 'page.html', format: 'png' });
    // `.html` beats `.htm` when one upload holds both spellings.
    expect(resolveExport(['a.htm', 'a.html'], 'a.pdf')?.source).toBe('a.html');
    expect(resolveExport(['a.htm'], 'a.pdf')?.source).toBe('a.htm');
  });

  it('markdown wins a contested base, so its .png stays a 404', () => {
    const both = ['deck.md', 'deck.html'];
    expect(resolveExport(both, 'deck.pdf')).toEqual({ source: 'deck.md', format: 'pdf' });
    expect(resolveExport(both, 'deck.png')).toBeNull();
  });
});

describe('derivedKey', () => {
  it('carries the cache version, so a brand change retires old artifacts', () => {
    const key = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'slides', 'pdf');
    expect(key).toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/deck.md.slides.pdf`);
  });

  it('keys by resolved mode, so a doc render never collides with a deck one', () => {
    const slides = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'slides', 'pdf');
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'doc', 'pdf')).not.toBe(slides);
  });

  it('keys a page mode by its extension', () => {
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'page.html', 'page', 'png'))
      .toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/page.html.page.png`);
  });

  /* A generation's stamp rides in the source name, which is what keeps each
     version's render its own immutable object. */
  it('keys each generated version separately', () => {
    const first = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.1000.md', 'slides', 'pdf');
    const second = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.2000.md', 'slides', 'pdf');
    expect(first).not.toBe(second);
  });

  it('sits under d/, which no upload may claim', () => {
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'a/b.md', 'doc', 'pdf'))
      .toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/a/b.md.doc.pdf`);
  });
});

describe('formatsFor', () => {
  const suffixes = (source: string) => formatsFor(source).map((s) => s.suffix);

  it('offers a markdown source the pdf and nothing else', () => {
    expect(suffixes('deck.md')).toEqual(['.pdf']);
    expect(suffixes('notes.markdown')).toEqual(suffixes('deck.md'));
    expect(suffixes('deck.1712.md')).toEqual(['.pdf']);
  });

  it('offers an uploaded page the print and the shot', () => {
    expect(suffixes('page.html')).toEqual(['.pdf', '.png']);
    expect(suffixes('page.htm')).toEqual(suffixes('page.html'));
  });

  it('offers an upload that is neither markdown nor a page nothing at all', () => {
    expect(formatsFor('hero.png')).toEqual([]);
    expect(formatsFor('notes.pdf')).toEqual([]);
  });

  /* A markdown render sniffs, so its mode is not known until the bytes are
     read; an uploaded page is always navigated. */
  it('pins a mode only where the source kind decides it', () => {
    expect(formatsFor('deck.md').map((s) => s.mode)).toEqual([null]);
    expect(formatsFor('page.html').map((s) => s.mode)).toEqual(['page', 'page']);
  });

  it('answers the same set resolveExport enforces', () => {
    const files = ['deck.md', 'page.html'];
    for (const source of files) {
      for (const spec of formatsFor(source)) {
        const requested = `${stemOf(source)}${spec.suffix}`;
        expect(resolveExport(files, requested)).toEqual({ source, format: spec.format });
      }
    }
  });

  it('stems a source down to what a suffix hangs off', () => {
    expect(stemOf('deck.md')).toBe('deck');
    expect(stemOf('notes.markdown')).toBe('notes');
    expect(stemOf('deck.1712.md')).toBe('deck.1712');
    expect(stemOf('a/b.page.html')).toBe('a/b.page');
    expect(stemOf('hero.png')).toBe('hero.png');
  });
});

describe('parseDerivedKey', () => {
  const SPACE = 'acme';
  const HASH = 'Xk92mQ7bTp01';
  const strip = (key: string) => key.slice(derivedPrefix(SPACE, HASH).length);

  /* The inverse has to cover the vocabulary exactly: a render the index page
     cannot decompose is one it will never list, however well it rendered. */
  it('decomposes every key derivedKey can build', () => {
    const cases = [
      ['deck.md', 'slides', 'pdf'], ['deck.md', 'doc', 'pdf'],
      ['a/b.name.1712.md', 'slides', 'pdf'],
      ['page.html', 'page', 'pdf'], ['page.html', 'page', 'png'],
    ] as const;
    for (const [source, mode, ext] of cases) {
      const key = derivedKey(SPACE, HASH, source, mode, ext);
      expect(parseDerivedKey(strip(key))).toEqual({ source, mode, ext });
    }
  });

  it('reads a source whose own name ends in a tail it could have written', () => {
    const key = derivedKey(SPACE, HASH, 'a.page.pdf.html', 'page', 'pdf');
    expect(parseDerivedKey(strip(key))).toEqual({ source: 'a.page.pdf.html', mode: 'page', ext: 'pdf' });
  });

  it('rejects the check verdict, a bare tail, and anything else under the prefix', () => {
    expect(parseDerivedKey('deck.md.check.json')).toBeNull();
    expect(parseDerivedKey('slides.pdf')).toBeNull();
    expect(parseDerivedKey('deck.md.doc.png')).toBeNull();
  });

  it('reads the check verdict back to its source, and only that', () => {
    expect(parseCheckKey(strip(checkKey(SPACE, HASH, 'a/b.md')))).toBe('a/b.md');
    expect(parseCheckKey('deck.md.slides.pdf')).toBeNull();
    expect(parseCheckKey('check.json')).toBeNull();
  });
});

/* The docs are what a model reads before it asks for a URL, so a row they list
   and the catalog does not is a 404 waiting to happen, and a format the catalog
   grows without a row is one nobody will ask for. */
describe('the published docs list the catalog', () => {
  const offered = (source: string) => formatsFor(source).map((s) => s.suffix);

  it('the skill table holds every markdown spelling and no other', () => {
    const doc = readFileSync('skills/share/SKILL.md', 'utf8');
    const listed = [...doc.matchAll(/^\| `deck\.(\S+)` \|/gm)].map((m) => `.${m[1]}`);
    // The source itself heads the table; the rest are the suffixes it answers.
    expect(new Set(listed)).toEqual(new Set(['.md', ...offered('deck.md')]));
  });

  it('llms.txt holds both columns', () => {
    const doc = readFileSync('public/llms.txt', 'utf8');
    const listed = (re: RegExp) => new Set([...doc.matchAll(re)].map((m) => `.${m[1]}`));
    expect(listed(/^ {4}deck\.(\S+) /gm)).toEqual(new Set(['.md', ...offered('deck.md')]));
    expect(listed(/^ {4}page\.(\S+) /gm)).toEqual(new Set(offered('page.html')));
  });
});

describe('sniffDeck', () => {
  it('Marp front matter means deck', () => {
    expect(sniffDeck('---\nmarp: true\ntheme: nt\n---\n\n# Title\n')).toBe(true);
    expect(sniffDeck('---\ntitle: Notes\n---\n\nJust prose.\n')).toBe(false);
  });

  it('blank-line separators mean deck', () => {
    expect(sniffDeck('# One\n\ntext\n\n---\n\n# Two\n')).toBe(true);
    expect(sniffDeck('# One\n\ntext\n\n----\n\n# Two\n')).toBe(true);
  });

  /* Marpit splits on the thematic break only, and a `---` under a non-blank
     line is a setext heading. Sniffing those as slides would break every doc
     that underlines its title. */
  it('a setext underline is not a slide break', () => {
    expect(sniffDeck('My title\n---\n\nBody text.\n')).toBe(false);
    expect(sniffDeck('Heading\n---\nMore\n')).toBe(false);
  });

  it('front matter alone does not make a deck', () => {
    expect(sniffDeck('---\nauthor: sara\n---\n\nOne page, no breaks.\n')).toBe(false);
  });

  it('plain prose is a document', () => {
    expect(sniffDeck('# Report\n\nParagraph one.\n\nParagraph two.\n')).toBe(false);
    expect(sniffDeck('')).toBe(false);
  });
});
