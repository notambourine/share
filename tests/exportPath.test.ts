import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION, parseExportPath, resolveExport, explicitMode,
  formatExt, derivedKey, sniffDeck,
} from '../src/lib/exportPath';

describe('parseExportPath', () => {
  it('reads every suffix in the grammar', () => {
    expect(parseExportPath('deck.md.slides.html')).toEqual({ source: 'deck.md', format: 'slides-html' });
    expect(parseExportPath('deck.md.html')).toEqual({ source: 'deck.md', format: 'html' });
    expect(parseExportPath('deck.md.pdf')).toEqual({ source: 'deck.md', format: 'pdf' });
    expect(parseExportPath('deck.md.slides.pdf')).toEqual({ source: 'deck.md', format: 'slides-pdf' });
    expect(parseExportPath('deck.md.doc.pdf')).toEqual({ source: 'deck.md', format: 'doc-pdf' });
  });

  it('takes the longest suffix, so .slides.html never reads as .html', () => {
    expect(parseExportPath('a.md.slides.html')?.format).toBe('slides-html');
    expect(parseExportPath('a.md.slides.pdf')?.format).toBe('slides-pdf');
    expect(parseExportPath('a.md.doc.pdf')?.format).toBe('doc-pdf');
  });

  it('keeps nested paths intact', () => {
    expect(parseExportPath('docs/q3/deck.md.pdf')).toEqual({ source: 'docs/q3/deck.md', format: 'pdf' });
  });

  it('rejects a bare suffix and anything unsuffixed', () => {
    expect(parseExportPath('.pdf')).toBeNull();
    expect(parseExportPath('deck.md')).toBeNull();
    expect(parseExportPath('shot.png')).toBeNull();
  });
});

describe('resolveExport', () => {
  const files = ['deck.md', 'notes.markdown', 'report.pdf', 'shot.png'];

  it('resolves a suffix onto an uploaded markdown file', () => {
    expect(resolveExport(files, 'deck.md.pdf')).toEqual({ source: 'deck.md', format: 'pdf' });
    expect(resolveExport(files, 'notes.markdown.doc.pdf')?.source).toBe('notes.markdown');
  });

  /* R12 says fail loudly rather than mangle; silently re-rendering over a real
     upload would be the quiet version of the same mistake. */
  it('lets a real uploaded file win its own name', () => {
    expect(resolveExport(files, 'report.pdf')).toBeNull();
    expect(resolveExport([...files, 'deck.md.pdf'], 'deck.md.pdf')).toBeNull();
  });

  it('refuses a source that is not markdown or was never uploaded', () => {
    expect(resolveExport(files, 'shot.png.pdf')).toBeNull();
    expect(resolveExport(files, 'missing.md.pdf')).toBeNull();
    expect(resolveExport(files, 'index.html.pdf')).toBeNull();
  });
});

describe('mode and extension', () => {
  it('only the explicit spellings carry a mode', () => {
    expect(explicitMode('slides-pdf')).toBe('slides');
    expect(explicitMode('slides-html')).toBe('slides');
    expect(explicitMode('doc-pdf')).toBe('doc');
    expect(explicitMode('pdf')).toBeNull();
    expect(explicitMode('html')).toBeNull();
  });

  it('maps format to output extension', () => {
    expect(formatExt('slides-html')).toBe('html');
    expect(formatExt('html')).toBe('html');
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
