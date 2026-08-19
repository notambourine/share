/**
 * What an uploaded artifact can become: one catalog of spellings, pure and unit
 * tested. The admin tiles, the status route, and the client poll all read it,
 * so a new format is added here and nowhere else.
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
export const CACHE_VERSION = 4;

export type ExportFormat =
  | 'slides-html' | 'doc-html' | 'pdf' | 'slides-pdf' | 'doc-pdf' | 'txt'
  | 'png' | 'full-png';

/** A rendered format; `txt` is the source's own bytes and never renders. */
export type RenderFormat = Exclude<ExportFormat, 'txt'>;

/** What renders: `slides` one page per slide, `doc` A4 print HTML, `page` a
    navigated upload (the uploaded HTML itself, loaded at its served URL). */
export type RenderMode = 'slides' | 'doc' | 'page';

/** What a source kind may become. `tile` is offered on the admin page, `quiet`
    answers its URL without one, null is a 404: PNG is HTML-only and markdown
    keeps its family, so a md base asked for `.png` invents no render. The
    sniffing spellings stay quiet - a tile has to say which mode it hands
    back. */
type Offer = 'tile' | 'quiet' | null;

interface FormatRow {
  suffix: string;
  format: ExportFormat;
  /** How a markdown source offers it, and how an uploaded page does. */
  md: Offer;
  page: Offer;
  /** Tile copy, on every row: a spelling nobody tiles today still has a name. */
  label: string;
  sub: string;
  /** Portrait thumb - a printed page - rather than landscape. */
  portrait: boolean;
}

/* Order is tile order on the admin page. Parsing takes the longest match, so no
   row's position is load-bearing and this list stays free to read as a menu. */
const FORMATS: FormatRow[] = [
  { suffix: '.slides.html', format: 'slides-html', md: 'tile', page: null,
    label: 'deck', sub: 'every slide, one at a time', portrait: false },
  { suffix: '.doc.html', format: 'doc-html', md: 'tile', page: null,
    label: 'document', sub: 'the same words, as prose', portrait: true },
  { suffix: '.slides.pdf', format: 'slides-pdf', md: 'tile', page: null,
    label: 'deck pdf', sub: 'for email attachments', portrait: false },
  { suffix: '.doc.pdf', format: 'doc-pdf', md: 'tile', page: null,
    label: 'document pdf', sub: 'same words, one page after another', portrait: true },
  { suffix: '.txt', format: 'txt', md: 'tile', page: null,
    label: 'source', sub: 'the markdown itself', portrait: false },
  { suffix: '.pdf', format: 'pdf', md: 'quiet', page: 'tile',
    label: 'pdf', sub: 'print of the page', portrait: true },
  { suffix: '.png', format: 'png', md: null, page: 'tile',
    label: 'full shot', sub: 'the whole page, one image', portrait: true },
  { suffix: '.full.png', format: 'full-png', md: null, page: 'quiet',
    label: 'full shot', sub: 'the whole page, one image', portrait: true },
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
  let best: ParsedExport | null = null;
  let taken = 0;
  /* Longest match, not first: `.slides.html` must not lose its tail to `.html`
     however the catalog is ordered. */
  for (const { suffix, format } of FORMATS) {
    if (suffix.length <= taken || !path.endsWith(suffix)) continue;
    const base = path.slice(0, -suffix.length);
    if (!base) continue;
    best = { base, format };
    taken = suffix.length;
  }
  return best;
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

const MD_EXT = /\.(md|markdown)$/i;
const PAGE_EXT = /\.html?$/i;

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

/** The stem a suffix hangs off: `deck.md` -> `deck`. A file that exports
    nothing keeps its whole name. */
export function stemOf(source: string): string {
  return source.replace(MD_EXT, '').replace(PAGE_EXT, '');
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
  const offered = formatsFor(source).some((spec) => spec.format === parsed.format);
  return offered ? { source, format: parsed.format } : null;
}

/** An `.html` spelling over a markdown source. */
export type LiveHtmlFormat = 'slides-html' | 'doc-html';

function isHtmlSpelling(format: ExportFormat): format is LiveHtmlFormat {
  return format.endsWith('html');
}

/**
 * The `.html` spellings render live in the Worker, so they store nothing and a
 * brand edit reaches them on the next view. They exist to pin the mode - a
 * stable URL that says "read this one as slides" - rather than to hand back a
 * file, which is what `.pdf` is for.
 */
export function isLiveHtml(source: string, format: ExportFormat): format is LiveHtmlFormat {
  return !isPageSource(source) && isHtmlSpelling(format);
}

/** null means the format carries no mode of its own and the content decides.
    Never `page`: that mode comes from the source being HTML, not from a suffix. */
export function explicitMode(format: RenderFormat): 'slides' | 'doc' | null {
  if (format === 'slides-html' || format === 'slides-pdf') return 'slides';
  if (format === 'doc-html' || format === 'doc-pdf') return 'doc';
  return null;
}

/** A page render's two outputs, one load. */
export type PageExt = 'pdf' | 'full.png';

/** Bare `.png` is the full shot's alias, the way bare `.pdf` aliases a
    sniffed mode: both spellings share one cached object. */
export function pageExt(format: ExportFormat): PageExt {
  return format === 'png' || format === 'full-png' ? 'full.png' : 'pdf';
}

function isRendered(format: ExportFormat): format is RenderFormat {
  return format !== 'txt';
}

/**
 * The readiness vocabulary: what the status route reports as `rendered[]`, what
 * a tile's `data-await` names, and the tail `derivedKey` writes. One string per
 * stored artifact, so the four modules that speak it cannot drift.
 */
export type RenderedKey = 'slides.pdf' | 'doc.pdf' | `page.${PageExt}`;

export function renderedKey(mode: RenderMode, ext: PageExt): RenderedKey {
  /* A print mode goes through print HTML, which only ever lands a pdf; the
     shots belong to a navigated page. */
  return mode === 'page' ? `page.${ext}` : `${mode}.pdf`;
}

/** One spelling of one source, with everything a tile or a poller needs. */
export interface ExportSpec {
  /** Hangs off `stemOf(source)`: `deck` + `.slides.pdf`. */
  suffix: string;
  format: ExportFormat;
  /** The mode this spelling pins; null when the content decides it. */
  mode: RenderMode | null;
  /** The artifact it lands as; null when it lands none. */
  ext: PageExt | null;
  /** Goes through a browser and caches under `d/v<N>/`. */
  derived: boolean;
  /** The readiness key to wait on; null when nothing lands, and null on a
      sniffing spelling, whose mode is not known until the render runs. */
  awaits: RenderedKey | null;
  /** Offered as a tile on the admin page. */
  tile: boolean;
  label: string;
  sub: string;
  portrait: boolean;
  /** The badge a tile prints on its thumb; null on the source itself. */
  badge: 'html' | 'pdf' | 'png' | null;
}

function modeOf(column: 'md' | 'page', format: ExportFormat): RenderMode | null {
  if (column === 'page') return 'page';
  return isRendered(format) ? explicitMode(format) : null;
}

/** The artifact a spelling lands in R2, or null when it lands none: `.txt` is
    the source's own bytes and an `.html` spelling renders per request. */
function extOf(format: ExportFormat): PageExt | null {
  return isRendered(format) && !isHtmlSpelling(format) ? pageExt(format) : null;
}

function badgeOf(format: ExportFormat): 'html' | 'pdf' | 'png' | null {
  if (format.endsWith('html')) return 'html';
  if (format.endsWith('pdf')) return 'pdf';
  if (format.endsWith('png')) return 'png';
  return null;
}

/** Everything `source` can become, in tile order. Empty for an upload that
    exports nothing, which is what makes this the readiness test too. */
export function formatsFor(source: string): ExportSpec[] {
  const column = offerColumn(source);
  if (!column) return [];
  const specs: ExportSpec[] = [];
  for (const row of FORMATS) {
    const offer = column === 'md' ? row.md : row.page;
    if (!offer) continue;
    const mode = modeOf(column, row.format);
    const ext = extOf(row.format);
    specs.push({
      suffix: row.suffix,
      format: row.format,
      mode,
      ext,
      derived: ext !== null,
      awaits: mode && ext ? renderedKey(mode, ext) : null,
      tile: offer === 'tile',
      label: row.label,
      sub: row.sub,
      portrait: row.portrait,
      badge: badgeOf(row.format),
    });
  }
  return specs;
}

/** Every tail `derivedKey` can write, from the catalog itself, so a format
    becomes parseable the moment it is offered. */
function derivedTails(): Map<string, { mode: RenderMode; ext: PageExt }> {
  const tails = new Map<string, { mode: RenderMode; ext: PageExt }>();
  for (const row of FORMATS) {
    const ext = extOf(row.format);
    if (!ext) continue;
    if (row.page) tails.set(renderedKey('page', ext), { mode: 'page', ext });
    /* A sniffing spelling contributes no tail of its own: it lands under the
       explicit mode it sniffed to, which is already here. */
    const mode = row.md ? modeOf('md', row.format) : null;
    if (mode) tails.set(renderedKey(mode, ext), { mode, ext });
  }
  return tails;
}

const TAILS = derivedTails();

export function isRenderedKey(value: string | undefined): value is RenderedKey {
  return value !== undefined && TAILS.has(value);
}

const CHECK_TAIL = 'check.json';

/** Where a hash's derived artifacts live. The one place a key spells the cache
    version, so no route has to know the cache is versioned at all. */
export function derivedPrefix(space: string, hash: string): string {
  return `${space}/${hash}/d/v${CACHE_VERSION}/`;
}

/** Keyed by resolved mode, not by requested spelling, so `.pdf` and the
    explicit spelling it sniffs to share one cached object. */
export function derivedKey(
  space: string, hash: string, source: string, mode: RenderMode, ext: PageExt,
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
  ext: PageExt;
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
 * Deck or document, from the content. A bare `.md` URL and a bare `.pdf` sniff;
 * the explicit spellings never reach here.
 */
export function sniffDeck(markdown: string): boolean {
  const { front, body } = splitFrontMatter(markdown);
  if (/^[ \t]*marp[ \t]*:[ \t]*true[ \t]*$/m.test(front)) return true;
  /* A `---` under a non-blank line is a setext heading, not a slide break.
     Marpit splits on the thematic break only, so the blank line is load-bearing. */
  return /(^|\n)[ \t]*\n[ \t]*-{3,}[ \t]*(\n|$)/.test(body);
}
