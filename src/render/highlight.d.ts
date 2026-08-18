/**
 * highlight.js, from the same pinned package the browser bundle used to load as
 * a script tag - `es/` is that build's ES-module twin, so the Worker highlights
 * against the identical 36-language set rather than a second pin.
 *
 * Names only the surface this repo calls, the way src/client/vendor.d.ts did:
 * widen it and the typecheck stops reporting that a bump changed something.
 */
declare module '@highlightjs/cdn-assets/es/highlight.min.js' {
  interface HighlightResult {
    value: string;
  }
  interface Language {
    name?: string;
  }
  const hljs: {
    highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): HighlightResult;
    getLanguage(name: string): Language | undefined;
  };
  export default hljs;
}
