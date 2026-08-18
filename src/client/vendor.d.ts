/**
 * The vendored renderers, which arrive as globals from `public/vendor/*` rather
 * than as imports: `npm run vendor` builds them as IIFEs so a shell can load
 * them with a plain script tag and no module graph.
 *
 * Each declaration names only the surface this repo calls. Widen one and the
 * typecheck stops telling you that a vendor bump changed something. They are
 * exported as well as declared so a test can build a stub that satisfies the
 * same shape rather than casting one into place.
 */

export interface HighlightJs {
  highlightElement(el: Element): void;
}

export interface MarkedParser {
  parse(markdown: string): string;
}

/** Marpit's Theme. `name` is the only field this repo has any use for; the deck
    only ever moves a theme from `add()` to `default`. */
export interface MarpitTheme {
  name: string;
}

export interface MarpitThemeSet {
  default: MarpitTheme;
  add(css: string): MarpitTheme;
}

export interface MarpitRender {
  html: string;
  css: string;
}

export interface MarpitInstance {
  themeSet: MarpitThemeSet;
  render(markdown: string): MarpitRender;
}

export interface MarpitOptions {
  inlineSVG: boolean;
  markdown: [string, { html: boolean; linkify: boolean }];
}

export interface MarpitConstructor {
  new (options: MarpitOptions): MarpitInstance;
}

declare global {
  interface Window {
    hljs?: HighlightJs;
    marked?: MarkedParser;
    Marpit?: { Marpit: MarpitConstructor };
  }
}
