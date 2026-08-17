/**
 * Format suffixes on a markdown path. Pure functions, unit tested.
 *
 * A suffix is an override like `?raw`: it decides the output on its own and
 * `Accept` never gets a vote. Resolution runs only after an exact filename
 * lookup misses, so a real uploaded file always wins its own name.
 */

/**
 * Derived artifacts cache under `d/v<N>/`. Hashes are immutable, so nothing
 * else invalidates a stored PDF. Bump on any change to tokens.css, nt-marp.css,
 * print.css, or the print HTML; old versions age out with their upload.
 */
export const CACHE_VERSION = 2;

export type ExportFormat = 'slides-html' | 'html' | 'doc-html' | 'pdf' | 'slides-pdf' | 'doc-pdf' | 'txt';

/** A rendered format; `txt` is the source's own bytes and never renders. */
export type RenderFormat = Exclude<ExportFormat, 'txt'>;

/** What the print HTML renders as. `slides` is one page per slide, `doc` is A4. */
export type RenderMode = 'slides' | 'doc';

/* Longest first: `.slides.html` must not lose its tail to `.html`. */
const SUFFIXES: [string, ExportFormat][] = [
  ['.slides.html', 'slides-html'],
  ['.slides.pdf', 'slides-pdf'],
  ['.doc.html', 'doc-html'],
  ['.doc.pdf', 'doc-pdf'],
  ['.html', 'html'],
  ['.pdf', 'pdf'],
  ['.txt', 'txt'],
];

export interface ExportRequest {
  /** The uploaded markdown file the suffix resolved to. */
  source: string;
  format: ExportFormat;
}

interface ParsedExport {
  /** The requested name with the suffix cut: `deck.pdf` -> `deck`. */
  base: string;
  format: ExportFormat;
}

export function parseExportPath(path: string): ParsedExport | null {
  for (const [suffix, format] of SUFFIXES) {
    if (!path.endsWith(suffix)) continue;
    const base = path.slice(0, -suffix.length);
    if (base) return { base, format };
  }
  return null;
}

function sourceFor(paths: readonly string[], base: string): string | null {
  const matches = paths.filter((p) => {
    const m = /^(.*)\.(md|markdown)$/i.exec(p);
    return m !== null && m[1] === base;
  });
  // `.md` beats `.markdown` when one upload holds both spellings (llms.txt).
  return matches.find((p) => /\.md$/i.test(p)) ?? matches[0] ?? null;
}

/**
 * Resolve a requested path against the upload's file list: `deck.pdf` finds
 * the uploaded `deck.md`. Returns null when an uploaded file owns the name,
 * so `notes.pdf` uploaded as a real PDF serves its own bytes rather than
 * re-rendering `notes`.
 */
export function resolveExport(paths: readonly string[], requested: string): ExportRequest | null {
  if (paths.includes(requested)) return null;
  const parsed = parseExportPath(requested);
  if (!parsed) return null;
  const source = sourceFor(paths, parsed.base);
  return source ? { source, format: parsed.format } : null;
}

/** null means the format carries no mode of its own and the content decides. */
export function explicitMode(format: RenderFormat): RenderMode | null {
  if (format === 'slides-html' || format === 'slides-pdf') return 'slides';
  if (format === 'doc-html' || format === 'doc-pdf') return 'doc';
  return null;
}

export function formatExt(format: RenderFormat): 'html' | 'pdf' {
  return format === 'slides-html' || format === 'html' || format === 'doc-html' ? 'html' : 'pdf';
}

/** Keyed by resolved mode, not by requested spelling, so `.pdf` and the
    explicit spelling it sniffs to share one cached object. */
export function derivedKey(
  space: string, hash: string, source: string, mode: RenderMode, ext: 'html' | 'pdf',
): string {
  return `${space}/${hash}/d/v${CACHE_VERSION}/${source}.${mode}.${ext}`;
}

interface FrontMatter {
  front: string;
  body: string;
}

export function splitFrontMatter(markdown: string): FrontMatter {
  if (!/^---[ \t]*\r?\n/.test(markdown)) return { front: '', body: markdown };
  const end = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown.slice(3));
  if (!end) return { front: '', body: markdown };
  const stop = 3 + end.index + end[0].length;
  return { front: markdown.slice(4, 3 + end.index), body: markdown.slice(stop) };
}

/**
 * Deck or document, from the content. Bare `.pdf` and `.html` sniff; the
 * explicit spellings never reach here.
 */
export function sniffDeck(markdown: string): boolean {
  const { front, body } = splitFrontMatter(markdown);
  if (/^[ \t]*marp[ \t]*:[ \t]*true[ \t]*$/m.test(front)) return true;
  /* A `---` under a non-blank line is a setext heading, not a slide break.
     Marpit splits on the thematic break only, so the blank line is load-bearing. */
  return /(^|\n)[ \t]*\n[ \t]*-{3,}[ \t]*(\n|$)/.test(body);
}
