import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION, parseExportPath, resolveExport, explicitMode,
  isLiveHtml, pageExt, derivedKey, checkKey, sniffDeck,
  formatsFor, stemOf, isRenderedKey,
  derivedPrefix, parseDerivedKey, parseCheckKey,
} from '../src/lib/exportPath';

describe('parseExportPath', () => {
  it('reads every suffix in the grammar', () => {
    expect(parseExportPath('deck.slides.html')).toEqual({ base: 'deck', format: 'slides-html' });
    expect(parseExportPath('deck.html')).toEqual({ base: 'deck', format: 'html' });
    expect(parseExportPath('deck.doc.html')).toEqual({ base: 'deck', format: 'doc-html' });
    expect(parseExportPath('deck.pdf')).toEqual({ base: 'deck', format: 'pdf' });
    expect(parseExportPath('deck.slides.pdf')).toEqual({ base: 'deck', format: 'slides-pdf' });
    expect(parseExportPath('deck.doc.pdf')).toEqual({ base: 'deck', format: 'doc-pdf' });
    expect(parseExportPath('deck.txt')).toEqual({ base: 'deck', format: 'txt' });
    expect(parseExportPath('page.png')).toEqual({ base: 'page', format: 'png' });
    expect(parseExportPath('page.full.png')).toEqual({ base: 'page', format: 'full-png' });
    expect(parseExportPath('page.browser.png')).toEqual({ base: 'page', format: 'browser-png' });
  });

  it('takes the longest suffix, so .slides.html never reads as .html', () => {
    expect(parseExportPath('a.slides.html')?.format).toBe('slides-html');
    expect(parseExportPath('a.slides.pdf')?.format).toBe('slides-pdf');
    expect(parseExportPath('a.doc.html')?.format).toBe('doc-html');
    expect(parseExportPath('a.doc.pdf')?.format).toBe('doc-pdf');
    expect(parseExportPath('a.full.png')?.format).toBe('full-png');
    expect(parseExportPath('a.browser.png')?.format).toBe('browser-png');
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

  it('resolves a suffix onto the uploaded markdown source', () => {
    expect(resolveExport(files, 'deck.pdf')).toEqual({ source: 'deck.md', format: 'pdf' });
    expect(resolveExport(files, 'deck.txt')).toEqual({ source: 'deck.md', format: 'txt' });
    expect(resolveExport(files, 'notes.doc.pdf')?.source).toBe('notes.markdown');
  });

  it('the old deck.md.pdf spelling is gone, no shim', () => {
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
    expect(resolveExport(files, 'shot.png.pdf')).toBeNull();
    expect(resolveExport(files, 'missing.pdf')).toBeNull();
    // shot.png is a real upload, never an export of itself.
    expect(resolveExport(files, 'shot.png')).toBeNull();
  });

  it('falls back to an .html source, which takes .pdf and the shots only', () => {
    const page = ['page.html', 'shot.png'];
    expect(resolveExport(page, 'page.pdf')).toEqual({ source: 'page.html', format: 'pdf' });
    expect(resolveExport(page, 'page.png')).toEqual({ source: 'page.html', format: 'png' });
    expect(resolveExport(page, 'page.full.png')).toEqual({ source: 'page.html', format: 'full-png' });
    expect(resolveExport(page, 'page.browser.png')).toEqual({ source: 'page.html', format: 'browser-png' });
    // Markdown's family stays markdown-only.
    expect(resolveExport(page, 'page.txt')).toBeNull();
    expect(resolveExport(page, 'page.slides.pdf')).toBeNull();
    expect(resolveExport(page, 'page.doc.html')).toBeNull();
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

describe('mode and extension', () => {
  it('only the explicit spellings carry a mode', () => {
    expect(explicitMode('slides-pdf')).toBe('slides');
    expect(explicitMode('slides-html')).toBe('slides');
    expect(explicitMode('doc-pdf')).toBe('doc');
    expect(explicitMode('doc-html')).toBe('doc');
    expect(explicitMode('pdf')).toBeNull();
    expect(explicitMode('html')).toBeNull();
  });

  /* The split that decides whether a request reaches a browser at all: an
     `.html` spelling renders in the Worker, a `.pdf` needs a print engine. */
  it('sorts the html spellings away from the ones that store an artifact', () => {
    for (const f of ['slides-html', 'html', 'doc-html'] as const) {
      expect(isLiveHtml('deck.md', f)).toBe(true);
    }
    for (const f of ['pdf', 'slides-pdf', 'doc-pdf', 'txt'] as const) {
      expect(isLiveHtml('deck.md', f)).toBe(false);
    }
  });

  it('an uploaded HTML source never renders live: it is already a page', () => {
    expect(isLiveHtml('page.html', 'html')).toBe(false);
    expect(isLiveHtml('page.htm', 'slides-html')).toBe(false);
  });
});

describe('derivedKey', () => {
  /* A cached PDF is the one thing here that can drift from the brand source,
     because hashes are immutable and nothing else invalidates it. */
  it('carries the cache version, so a brand change retires old artifacts', () => {
    const key = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'slides', 'pdf');
    expect(key).toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/deck.md.slides.pdf`);
    expect(key).toContain('/d/v');
  });

  it('keys by resolved mode, so .pdf and its explicit spelling share one object', () => {
    const sniffed = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'slides', 'pdf');
    const explicit = derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'slides', 'pdf');
    expect(sniffed).toBe(explicit);
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'deck.md', 'doc', 'pdf')).not.toBe(sniffed);
  });

  it('page mode keys the three outputs, bare .png sharing the full shot', () => {
    expect(pageExt('png')).toBe('full.png');
    expect(pageExt('full-png')).toBe('full.png');
    expect(pageExt('browser-png')).toBe('browser.png');
    expect(pageExt('pdf')).toBe('pdf');
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'page.html', 'page', 'full.png'))
      .toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/page.html.page.full.png`);
  });

  it('sits under d/, which no upload may claim', () => {
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'a/b.md', 'doc', 'pdf'))
      .toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/a/b.md.doc.pdf`);
  });
});

describe('formatsFor', () => {
  const suffixes = (source: string) => formatsFor(source).map((s) => s.suffix);
  const tiled = (source: string) => formatsFor(source).filter((s) => s.tile).map((s) => s.suffix);

  it('offers a markdown source its family and nothing else', () => {
    expect(suffixes('deck.md')).toEqual([
      '.slides.html', '.doc.html', '.slides.pdf', '.doc.pdf', '.txt', '.html', '.pdf',
    ]);
    expect(suffixes('notes.markdown')).toEqual(suffixes('deck.md'));
  });

  it('offers an uploaded page the print and the shots', () => {
    expect(suffixes('page.html')).toEqual(['.pdf', '.png', '.browser.png', '.full.png']);
    expect(suffixes('page.htm')).toEqual(suffixes('page.html'));
  });

  it('offers an upload that is neither markdown nor a page nothing at all', () => {
    expect(formatsFor('hero.png')).toEqual([]);
    expect(formatsFor('notes.pdf')).toEqual([]);
  });

  /* The admin page shows a spelling only when its name says what comes back:
     the sniffing ones answer their URL without a tile of their own. */
  it('tiles the pinned spellings, keeping the sniffing ones quiet', () => {
    expect(tiled('deck.md')).toEqual(['.slides.html', '.doc.html', '.slides.pdf', '.doc.pdf', '.txt']);
    expect(tiled('page.html')).toEqual(['.pdf', '.png', '.browser.png']);
  });

  it('waits only on what a browser has to draw, and only when the mode is pinned', () => {
    const awaits = (source: string) => new Map(formatsFor(source).map((s) => [s.suffix, s.awaits]));
    expect(awaits('deck.md')).toEqual(new Map([
      ['.slides.html', null], ['.doc.html', null],
      ['.slides.pdf', 'slides.pdf'], ['.doc.pdf', 'doc.pdf'],
      ['.txt', null],
      ['.html', null],
      // Bare `.pdf` derives, but which key it lands under is not known until
      // the sniff runs, so no tile could poll for it.
      ['.pdf', null],
    ]));
    expect(awaits('page.html')).toEqual(new Map([
      ['.pdf', 'page.pdf'], ['.png', 'page.full.png'],
      ['.browser.png', 'page.browser.png'], ['.full.png', 'page.full.png'],
    ]));
  });

  it('marks every spelling that reaches a browser, sniffing ones included', () => {
    const derived = (source: string) => formatsFor(source).filter((s) => s.derived).map((s) => s.suffix);
    expect(derived('deck.md')).toEqual(['.slides.pdf', '.doc.pdf', '.pdf']);
    expect(derived('page.html')).toEqual(['.pdf', '.png', '.browser.png', '.full.png']);
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
    expect(stemOf('a/b.page.html')).toBe('a/b.page');
    expect(stemOf('hero.png')).toBe('hero.png');
  });
});

describe('parseDerivedKey', () => {
  const SPACE = 'acme';
  const HASH = 'Xk92mQ7bTp01';
  const strip = (key: string) => key.slice(derivedPrefix(SPACE, HASH).length);

  /* The inverse has to cover the catalog exactly: a format the status route
     cannot decompose reports "pending" forever, however well it renders. */
  it('decomposes every key derivedKey can build', () => {
    for (const source of ['deck.md', 'notes.markdown', 'a/b.name.md', 'page.html']) {
      for (const spec of formatsFor(source)) {
        if (!spec.mode || !spec.ext) continue;
        const key = derivedKey(SPACE, HASH, source, spec.mode, spec.ext);
        expect(parseDerivedKey(strip(key))).toEqual({ source, mode: spec.mode, ext: spec.ext });
      }
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

  it('recognises the vocabulary the tiles and the poll trade in', () => {
    expect(isRenderedKey('slides.pdf')).toBe(true);
    expect(isRenderedKey('page.browser.png')).toBe(true);
    expect(isRenderedKey('slides.full.png')).toBe(false);
    expect(isRenderedKey(undefined)).toBe(false);
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

  it('llms.txt holds both columns, the untiled spellings included', () => {
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
