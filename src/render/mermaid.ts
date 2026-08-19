/**
 * ```mermaid fences, rendered to inline SVG in the Worker.
 *
 * Upstream mermaid needs a DOM - it builds elements and asks the browser for
 * `getBBox()` - so it could only ever have run in the viewer, which is the
 * round trip src/render/markdown.ts exists to have deleted. `beautiful-mermaid`
 * lays diagrams out from its own metric tables and returns a string, so a
 * diagram arrives drawn, a crawler reads its labels, and the print page needs
 * no second renderer to put one on paper.
 *
 * The SVG it returns is post-processed here rather than taken as-is. Four of
 * its habits are wrong for this Worker, and each fix is one pass below: a
 * Google Fonts `@import`, selectors that escape the diagram, a face this repo
 * does not serve, and ids fixed enough to collide.
 */

import { renderMermaidSVG } from 'beautiful-mermaid';

/**
 * The library's colour knobs on the golden set. Every value is a `var()`, so
 * one render serves both themes - the dark shell and the light print page read
 * the same SVG and the cascade picks the side, which is what keeps a diagram
 * from being a stored artifact.
 *
 * No entry may name the token it sets. These land as custom properties on the
 * svg, so `--line: var(--line)` is a cycle and computes to nothing; `line` and
 * `border` therefore cross to a neighbouring token rather than to their own.
 */
const THEME = {
  bg: 'var(--bg-card)',
  fg: 'var(--fg1)',
  muted: 'var(--fg3)',
  surface: 'var(--bg-raised)',
  border: 'var(--fg-mute)',
  line: 'var(--fg3)',
  accent: 'var(--accent-text)',
};

/** The class the scoped rules and nt-code.css both hang off. */
const CLASS = 'nt-mermaid';

/**
 * A `<style>` inside inline SVG is document-wide, not scoped to its own root:
 * the library's bare `svg`, `text`, and `.mono` selectors would reach the
 * lockup, every Marpit slide, and any `.mono` in the uploaded markdown. Each
 * selector is prefixed so the rules stop at the diagram that carries them.
 *
 * The `@import` goes with them. It is a Google Fonts URL, which `SHELL_CSP`
 * blocks anyway - and blocked is not the point: a stylesheet request would
 * carry the artifact URL to Google as a Referer.
 */
function scopeCss(css: string): string {
  return css
    /* Whole line, not up to the first `;`: the URL carries `wght@400;500;600`,
       so a semicolon-terminated match stops inside it and leaves the tail
       behind as a selector. */
    .replace(/^\s*@import\b.*$/gm, '')
    .replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel: string, body: string) => {
      const one = sel.trim();
      const scoped = one.split(',')
        .map((s) => s.trim())
        .map((s) => (s === 'svg' ? `svg.${CLASS}` : `svg.${CLASS} ${s}`))
        .join(',');
      /* Layout is already fixed by the time the string exists: the library
         sized every box off a table of advance ratios - 0.54 at weight 400 up
         to 0.6 at 600 - measured against Inter, the face it asks Google for.
         The brand's grotesk is the one here those numbers describe. The mono is
         not: JetBrains Mono advances a flat 0.6, so prose set in it comes out
         11% wider than the box it was measured for, and a sequence diagram's
         message labels run into the next lifeline. The library's own `.mono`
         rule is left alone - that text is measured at 0.6 and means it. */
      const fixed = one === 'text'
        ? body.replace(/font-family:[^;}]*/, 'font-family:var(--font-display)')
        : body;
      return `${scoped}{${fixed}}`;
    });
}

/**
 * Two diagrams on one page would otherwise both define `id="arrowhead"`. The
 * markers are byte-identical, so the picture survives the collision and the
 * document's validity does not. Keyed off the source rather than a counter: a
 * render is one pure call with no page to count within.
 */
function keyOf(source: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `m${(h >>> 0).toString(36)}`;
}

/**
 * One diagram, or null when the source is not one this renderer draws - a bad
 * header, or a type it has no layout for (pie, gantt, mindmap). Null is the
 * caller's cue to fall back to the fence as code, so an unsupported diagram
 * still shows its own source rather than vanishing.
 *
 * The `<pre>` is markdown-it's price, not a choice: it uses a fence hook's
 * return verbatim only when the string opens with `<pre`, and wraps anything
 * else in `<pre><code>`. shell.css and print.css spell their code-block box
 * `pre:not(.nt-diagram)` because of it. Both renderers get the same wrapper, so
 * a deck and its own PDF cannot disagree about the markup.
 */
export function renderMermaid(source: string): string | null {
  let svg: string;
  try {
    svg = renderMermaidSVG(source, THEME);
  } catch {
    return null;
  }
  const key = keyOf(source);
  const drawn = svg
    .replace('<svg ', `<svg class="${CLASS}" `)
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css: string) => `<style>${scopeCss(css)}</style>`)
    /* `data-id="` must not match, hence the lookbehind. */
    .replace(/(?<!-)\bid="/g, `id="${key}-`)
    .replace(/url\(#/g, `url(#${key}-`);
  return `<pre class="nt-diagram">${drawn}</pre>`;
}
