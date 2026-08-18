/**
 * Format suffixes on a markdown path. Pure functions, unit tested.
 *
 * A suffix is an override like `?raw`: it decides the output on its own and
 * `Accept` never gets a vote. Resolution runs only after an exact filename
 * lookup misses, so a real uploaded file always wins its own name.
 */

/**
 * Derived artifacts cache under `d/v<N>/`, and they are all binary now: PDFs and
 * PNGs, the two formats a print engine has to produce. Hashes are immutable, so
 * nothing else invalidates one. Bump on any change to tokens.css, nt-marp.css,
 * print.css, or the print HTML; old versions age out with their upload.
 *
 * A stored render is what forces a bump to be a human remembering, which is why
 * HTML no longer has one: a page is rendered by the request that asks for it, so
 * a brand edit reaches every share link ever made with nothing to invalidate.
 * Re-rendering a PDF costs a browser minute, so that one stays deliberate.
 */
export const CACHE_VERSION = 3;

export type ExportFormat =
  | 'slides-html' | 'html' | 'doc-html' | 'pdf' | 'slides-pdf' | 'doc-pdf' | 'txt'
  | 'png' | 'browser-png' | 'full-png';

/** A rendered format; `txt` is the source's own bytes and never renders. */
export type RenderFormat = Exclude<ExportFormat, 'txt'>;

/** What renders: `slides` one page per slide, `doc` A4 print HTML, `page` a
    navigated upload (the uploaded HTML itself, loaded at its served URL). */
export type RenderMode = 'slides' | 'doc' | 'page';

/* Longest first: `.slides.html` must not lose its tail to `.html`. */
const SUFFIXES: [string, ExportFormat][] = [
  ['.slides.html', 'slides-html'],
  ['.slides.pdf', 'slides-pdf'],
  ['.doc.html', 'doc-html'],
  ['.doc.pdf', 'doc-pdf'],
  ['.browser.png', 'browser-png'],
  ['.full.png', 'full-png'],
  ['.html', 'html'],
  ['.pdf', 'pdf'],
  ['.txt', 'txt'],
  ['.png', 'png'],
];

/** What each source kind may become. PNG is HTML-only; markdown keeps its
    family. A md base asked for `.png` 404s rather than inventing a render. */
const MD_FORMATS = new Set<ExportFormat>(['slides-html', 'html', 'doc-html', 'pdf', 'slides-pdf', 'doc-pdf', 'txt']);
const PAGE_FORMATS = new Set<ExportFormat>(['pdf', 'png', 'browser-png', 'full-png']);

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

function claim(paths: readonly string[], base: string, ext: RegExp, tie: RegExp): string | null {
  const matches = paths.filter((p) => {
    const m = ext.exec(p);
    return m !== null && m[1] === base;
  });
  return matches.find((p) => tie.test(p)) ?? matches[0] ?? null;
}

/** Markdown wins a contested base; `.html` falls back when no `.md` claims it.
    `.md` beats `.markdown` (and `.html` beats `.htm`) when one upload holds
    both spellings (llms.txt). */
function sourceFor(paths: readonly string[], base: string): string | null {
  return claim(paths, base, /^(.*)\.(md|markdown)$/i, /\.md$/i)
    ?? claim(paths, base, /^(.*)\.html?$/i, /\.html$/i);
}

/** An HTML source renders as a navigated page rather than from print HTML. */
export function isPageSource(source: string): boolean {
  return /\.html?$/i.test(source);
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
  if (!source) return null;
  const allowed = isPageSource(source) ? PAGE_FORMATS : MD_FORMATS;
  return allowed.has(parsed.format) ? { source, format: parsed.format } : null;
}

/** An `.html` spelling over a markdown source. */
export type LiveHtmlFormat = 'slides-html' | 'html' | 'doc-html';

/**
 * The `.html` spellings render live in the Worker, so they store nothing and a
 * brand edit reaches them on the next view. They exist to pin the mode - a
 * stable URL that says "read this one as slides" - rather than to hand back a
 * file, which is what `.pdf` is for.
 */
export function isLiveHtml(source: string, format: ExportFormat): format is LiveHtmlFormat {
  return !isPageSource(source)
    && (format === 'slides-html' || format === 'html' || format === 'doc-html');
}

/** null means the format carries no mode of its own and the content decides.
    Never `page`: that mode comes from the source being HTML, not from a suffix. */
export function explicitMode(format: RenderFormat): 'slides' | 'doc' | null {
  if (format === 'slides-html' || format === 'slides-pdf') return 'slides';
  if (format === 'doc-html' || format === 'doc-pdf') return 'doc';
  return null;
}

/** A page render's three outputs, one load. */
export type PageExt = 'pdf' | 'browser.png' | 'full.png';

/** Bare `.png` is the full shot's alias, the way bare `.pdf` aliases a
    sniffed mode: both spellings share one cached object. */
export function pageExt(format: RenderFormat): PageExt {
  if (format === 'browser-png') return 'browser.png';
  if (format === 'png' || format === 'full-png') return 'full.png';
  return 'pdf';
}

/** Keyed by resolved mode, not by requested spelling, so `.pdf` and the
    explicit spelling it sniffs to share one cached object. */
export function derivedKey(
  space: string, hash: string, source: string, mode: RenderMode, ext: PageExt,
): string {
  return `${space}/${hash}/d/v${CACHE_VERSION}/${source}.${mode}.${ext}`;
}

/** The slides render's overflow verdict. Under `d/v<N>/` beside the artifacts
    it describes, so it versions and dies with them. */
export function checkKey(space: string, hash: string, source: string): string {
  return `${space}/${hash}/d/v${CACHE_VERSION}/${source}.check.json`;
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
