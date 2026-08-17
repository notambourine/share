import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION, parseExportPath, resolveExport, explicitMode,
  formatExt, derivedKey, sniffDeck,
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
  });

  it('takes the longest suffix, so .slides.html never reads as .html', () => {
    expect(parseExportPath('a.slides.html')?.format).toBe('slides-html');
    expect(parseExportPath('a.slides.pdf')?.format).toBe('slides-pdf');
    expect(parseExportPath('a.doc.html')?.format).toBe('doc-html');
    expect(parseExportPath('a.doc.pdf')?.format).toBe('doc-pdf');
  });

  it('keeps nested paths intact', () => {
    expect(parseExportPath('docs/q3/deck.pdf')).toEqual({ base: 'docs/q3/deck', format: 'pdf' });
  });

  it('rejects a bare suffix and anything unsuffixed', () => {
    expect(parseExportPath('.pdf')).toBeNull();
    expect(parseExportPath('deck.md')).toBeNull();
    expect(parseExportPath('shot.png')).toBeNull();
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

  it('refuses a base that was never uploaded as markdown', () => {
    expect(resolveExport(files, 'shot.pdf')).toBeNull();
    expect(resolveExport(files, 'shot.png.pdf')).toBeNull();
    expect(resolveExport(files, 'missing.pdf')).toBeNull();
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

  it('maps format to output extension', () => {
    expect(formatExt('slides-html')).toBe('html');
    expect(formatExt('html')).toBe('html');
    expect(formatExt('doc-html')).toBe('html');
    expect(formatExt('pdf')).toBe('pdf');
    expect(formatExt('slides-pdf')).toBe('pdf');
    expect(formatExt('doc-pdf')).toBe('pdf');
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

  it('sits under d/, which no upload may claim', () => {
    expect(derivedKey('acme', 'Xk92mQ7bTp01', 'a/b.md', 'doc', 'html'))
      .toBe(`acme/Xk92mQ7bTp01/d/v${CACHE_VERSION}/a/b.md.doc.html`);
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
