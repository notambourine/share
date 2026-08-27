/**
 * What an uploaded or generated artifact can become: one catalog of spellings,
 * pure and unit tested. The admin tiles and the index page both read it, so a
 * new format is added here and nowhere else.
 *
 * Two spellings, `.pdf` and `.png`. Deck-or-document is never a suffix: it comes
 * from the source's own content, every time, because the pages that print these
 * links generate them and a human typing `deck.slides.pdf` was the only reason a
 * grammar existed.
 *
 * Resolution runs only after an exact filename lookup misses, so a real uploaded
 * file always wins its own name.
 */

/**
 * Derived artifacts cache under `d/v<N>/`, and they are all binary: PDFs and
 * PNGs, the two formats a print engine has to produce. Bump on any change to
 * tokens.css, nt-marp.css, print.css, or the print HTML; old versions age out
 * with their upload.
 *
 * A stored render is what forces a bump to be a human remembering, which is why
 * HTML has none: a page is rendered by the request that asks for it, so a brand
 * edit reaches every share link ever made with nothing to invalidate.
 * Re-rendering a PDF costs a browser minute, so that one stays deliberate.
 *
 * A derived key is keyed by its source's full name, and a generation lands under
 * a stamped name of its own (`deck.<epoch>.md`), so every stored render is still
 * immutable. What is mutable by design is the bare-name alias below: `deck.pdf`
 * follows whichever stamp is newest, so it names different bytes over time and
 * must never be cached as if it did not.
 */
export const CACHE_VERSION = 6;

/** The two spellings, which are also the two extensions a render lands under. */
export type ExportFormat = 'pdf' | 'png';

/** What renders: `slides` one page per slide, `doc` A4 print HTML, `page` a
    navigated upload (the uploaded HTML itself, loaded at its served URL). */
export type RenderMode = 'slides' | 'doc' | 'page';

interface FormatRow {
  suffix: string;
  format: ExportFormat;
  /** Whether a markdown source offers it, and whether an uploaded page does. */
  md: boolean;
  page: boolean;
  label: string;
  sub: string;
  /** Portrait thumb - a printed page - rather than landscape. */
  portrait: boolean;
}

/* Order is tile order. PNG is HTML-only: a markdown source keeps its family, so
   a md base asked for `.png` invents no render. */
const FORMATS: FormatRow[] = [
  { suffix: '.pdf', format: 'pdf', md: true, page: true,
    label: 'pdf', sub: 'for email attachments', portrait: true },
  { suffix: '.png', format: 'png', md: false, page: true,
    label: 'full shot', sub: 'the whole page, one image', portrait: true },
];

export interface ExportRequest {
  /** The source file the suffix resolved to. */
  source: string;
  format: ExportFormat;
}

interface ParsedExport {
  /** The requested name with the suffix cut: `deck.pdf` -> `deck`. */
  base: string;
  format: ExportFormat;
}

export function parseExportPath(path: string): ParsedExport | null {
  for (const { suffix, format } of FORMATS) {
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

const MD_EXT = /\.(md|markdown)$/i;
const PAGE_EXT = /\.html?$/i;

/** `<base>.<epoch>.md` and the rest of the source spellings, so a stamp is read
    back off the same extensions a bare name resolves through. */
const STAMPED = /^(.*)\.(\d+)\.(?:md|markdown|html?)$/i;

/**
 * The newest generated version of `base`: a generation lands as
 * `deck.<epoch>.md`, so the highest epoch is the current one. Null when this
 * share holds no stamped file under that base, which is every plain upload.
 *
 * Resolution by listing rather than by a stored pointer: there is nothing to
 * keep consistent and nothing to backfill onto shares that predate generation.
 */
export function latestStamped(paths: readonly string[], base: string): string | null {
  let best: { path: string; epoch: number } | null = null;
  for (const path of paths) {
    const m = STAMPED.exec(path);
    if (!m || m[1] !== base) continue;
    const epoch = Number(m[2]);
    if (!best || epoch > best.epoch) best = { path, epoch };
  }
  return best?.path ?? null;
}

/** The stamp a generated file carries, or null on an uploaded one. */
export function stampOf(path: string): number | null {
  const m = STAMPED.exec(path);
  return m ? Number(m[2]) : null;
}

/** Markdown wins a contested base; `.html` falls back when no `.md` claims it,
    and a stamped generation answers a bare base that no file spells exactly.
    `.md` beats `.markdown` (and `.html` beats `.htm`) when one upload holds
    both spellings (llms.txt). */
function sourceFor(paths: readonly string[], base: string): string | null {
  return claim(paths, base, /^(.*)\.(md|markdown)$/i, /\.md$/i)
    ?? claim(paths, base, /^(.*)\.html?$/i, /\.html$/i)
    ?? latestStamped(paths, base);
}

/** An HTML source renders as a navigated page rather than from print HTML. */
export function isPageSource(source: string): boolean {
  return PAGE_EXT.test(source);
}

/** Which column of the catalog a file reads; null is a file that exports
    nothing, which is every upload that is not markdown or a page. */
function offerColumn(source: string): 'md' | 'page' | null {
  if (MD_EXT.test(source)) return 'md';
  return isPageSource(source) ? 'page' : null;
}

/** The stem a suffix hangs off: `deck.md` -> `deck`, `deck.1712.md` ->
    `deck.1712`. A file that exports nothing keeps its whole name. */
export function stemOf(source: string): string {
  return source.replace(MD_EXT, '').replace(PAGE_EXT, '');
}

/** The name a bare request drops its stamp for: `deck.1712.md` -> `deck`. */
export function baseOf(source: string): string {
  const m = STAMPED.exec(source);
  return m ? m[1] : stemOf(source);
}

/**
 * Resolve a requested path against the share's file list: `deck.pdf` finds
 * `deck.md`, or the newest `deck.<epoch>.md` when the generation page wrote one.
 * Returns null when an uploaded file owns the name, so `notes.pdf` uploaded as a
 * real PDF serves its own bytes rather than re-rendering `notes`.
 */
export function resolveExport(paths: readonly string[], requested: string): ExportRequest | null {
  if (paths.includes(requested)) return null;
  const parsed = parseExportPath(requested);
  if (!parsed) return null;
  const source = sourceFor(paths, parsed.base);
  if (!source) return null;
  const offered = formatsFor(source).some((spec) => spec.format === parsed.format);
  return offered ? { source, format: parsed.format } : null;
}

/**
 * The readiness vocabulary: what the index page reports, and the tail
 * `derivedKey` writes. One string per stored artifact, so the modules that
 * speak it cannot drift.
 */
export type RenderedKey = `${'slides' | 'doc'}.pdf` | `page.${ExportFormat}`;

export function renderedKey(mode: RenderMode, ext: ExportFormat): RenderedKey {
  /* A print mode goes through print HTML, which only ever lands a pdf; the
     shots belong to a navigated page. */
  return mode === 'page' ? `page.${ext}` : `${mode}.pdf`;
}

/** One spelling of one source, with everything a tile or a listing needs. */
export interface ExportSpec {
  /** Hangs off `stemOf(source)`: `deck` + `.pdf`. */
  suffix: string;
  format: ExportFormat;
  /** The mode this spelling renders in; null when the content decides it. */
  mode: RenderMode | null;
  label: string;
  sub: string;
  portrait: boolean;
  /** The badge a tile prints on its thumb. */
  badge: ExportFormat;
}

/** Everything `source` can become, in tile order. Empty for a file that exports
    nothing, which is what makes this the renderable test too. */
export function formatsFor(source: string): ExportSpec[] {
  const column = offerColumn(source);
  if (!column) return [];
  const specs: ExportSpec[] = [];
  for (const row of FORMATS) {
    if (!(column === 'md' ? row.md : row.page)) continue;
    specs.push({
      suffix: row.suffix,
      format: row.format,
      /* A markdown source sniffs, always; an uploaded page is navigated. */
      mode: column === 'page' ? 'page' : null,
      label: row.label,
      sub: row.sub,
      portrait: row.portrait,
      badge: row.format,
    });
  }
  return specs;
}

/* The whole readiness vocabulary, spelled out: the catalog no longer pins a
   mode, so the four tails a render can land under are declared rather than
   derived from suffixes that stopped naming them. */
const TAIL_ROWS: [RenderedKey, { mode: RenderMode; ext: ExportFormat }][] = [
  ['slides.pdf', { mode: 'slides', ext: 'pdf' }],
  ['doc.pdf', { mode: 'doc', ext: 'pdf' }],
  ['page.pdf', { mode: 'page', ext: 'pdf' }],
  ['page.png', { mode: 'page', ext: 'png' }],
];

/* A Map keyed by string, because a key arrives off a stored object's name. The
   rows above carry the literal type, so a tail the vocabulary lacks fails there
   rather than typing as a hit here. */
const TAILS = new Map<string, { mode: RenderMode; ext: ExportFormat }>(TAIL_ROWS);

const CHECK_TAIL = 'check.json';

/** Where a hash's derived artifacts live. The one place a key spells the cache
    version, so no route has to know the cache is versioned at all. */
export function derivedPrefix(space: string, hash: string): string {
  return `${space}/${hash}/d/v${CACHE_VERSION}/`;
}

/** Keyed by resolved mode, not by requested spelling, and by the source's full
    stamped name, so each generation's render is its own immutable object. */
export function derivedKey(
  space: string, hash: string, source: string, mode: RenderMode, ext: ExportFormat,
): string {
  return `${derivedPrefix(space, hash)}${source}.${renderedKey(mode, ext)}`;
}

/** The slides render's overflow verdict. Under `d/v<N>/` beside the artifacts
    it describes, so it versions and dies with them. */
export function checkKey(space: string, hash: string, source: string): string {
  return `${derivedPrefix(space, hash)}${source}.${CHECK_TAIL}`;
}

interface DerivedParts {
  source: string;
  mode: RenderMode;
  ext: ExportFormat;
}

function cut(rest: string, tail: string): string | null {
  const end = rest.length - tail.length - 1;
  return end > 0 && rest.endsWith(`.${tail}`) ? rest.slice(0, end) : null;
}

/** `derivedKey` read backwards, from a key with `derivedPrefix` already off the
    front. Null on anything the catalog cannot have written. */
export function parseDerivedKey(rest: string): DerivedParts | null {
  for (const [tail, parts] of TAILS) {
    const source = cut(rest, tail);
    if (source !== null) return { source, ...parts };
  }
  return null;
}

/** `checkKey` read backwards: the source it judged, or null. */
export function parseCheckKey(rest: string): string | null {
  return cut(rest, CHECK_TAIL);
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
 * Deck or document, from the content. Every markdown view and every markdown
 * PDF comes through here; nothing pins a mode any more.
 */
export function sniffDeck(markdown: string): boolean {
  const { front, body } = splitFrontMatter(markdown);
  if (/^[ \t]*marp[ \t]*:[ \t]*true[ \t]*$/m.test(front)) return true;
  /* A `---` under a non-blank line is a setext heading, not a slide break.
     Marpit splits on the thematic break only, so the blank line is load-bearing. */
  return /(^|\n)[ \t]*\n[ \t]*-{3,}[ \t]*(\n|$)/.test(body);
}
