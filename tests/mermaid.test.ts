/**
 * ```mermaid fences. The renderer is a dependency, so what is worth pinning is
 * the four things src/render/mermaid.ts does to its output - none of which the
 * library promises, and each of which is a page-level bug when it stops
 * happening - plus the fallback that keeps an undrawable diagram readable.
 */

import { describe, expect, it } from 'vitest';
import { renderMermaid } from '../src/render/mermaid';
import { renderMarkdown, renderDeck } from '../src/render/markdown';

const FLOW = 'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]';
const fenced = (src: string) => `\`\`\`mermaid\n${src}\n\`\`\`\n`;

describe('a diagram', () => {
  it('draws to inline svg, with the labels as real text', () => {
    const out = renderMermaid(FLOW) ?? '';
    expect(out).toContain('<svg class="nt-mermaid"');
    expect(out).toContain('>Start<');
    expect(out).toContain('>Choice<');
  });

  /* The library asks Google Fonts for Inter. SHELL_CSP would block the request,
     but a blocked request is not the point: the stylesheet URL would carry the
     artifact URL to Google as a Referer. */
  it('reaches no origin', () => {
    const out = renderMermaid(FLOW) ?? '';
    expect(out).not.toContain('@import');
    expect(out).not.toContain('fonts.googleapis.com');
    /* The URL carries `wght@400;500;600;700`, so a rule dropped up to its first
       semicolon leaves the tail behind and the next selector swallows it. */
    expect(out).not.toContain('display=swap');
  });

  /* A `<style>` in inline SVG is document-wide. The library writes bare `svg`,
     `text`, and `.mono` selectors, which would otherwise reach the lockup, every
     Marpit slide, and any `.mono` the uploaded markdown carries. */
  it('scopes every selector it ships to itself', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(renderMermaid(FLOW) ?? '')?.[1] ?? '';
    expect(css.length).toBeGreaterThan(0);
    for (const [, sel] of css.matchAll(/(?:^|\})\s*([^{}]+?)\s*\{/g)) {
      expect(sel).toMatch(/^svg\.nt-mermaid(\s[\w.-]+)?$/);
    }
  });

  /* Boxes were sized off a table of advance ratios measured against Inter, so
     the face has to be the brand's grotesk - the mono advances wider than the
     table assumes and overruns the box it was measured for. */
  it('typesets in a brand token, never a face name of its own', () => {
    const out = renderMermaid(FLOW) ?? '';
    expect(out).toContain('font-family:var(--font-display)');
    expect(out).not.toContain('Inter');
  });

  /* The library measures its own `.mono` text at a flat 0.6 and means it, so
     that rule keeps the monospace it asked for. */
  it('leaves the mono rule alone', () => {
    const out = renderMermaid('classDiagram\n  class Foo { +bar() }\n  Foo <|-- Baz') ?? '';
    expect(out).toContain('svg.nt-mermaid .mono{');
    expect(out).toMatch(/svg\.nt-mermaid \.mono\{[^}]*monospace/);
  });

  /* Every marker id the library writes is a fixed name, so two diagrams on one
     page would define it twice. */
  it('namespaces its ids so two diagrams can share a page', () => {
    const both = `${renderMermaid(FLOW)}${renderMermaid('flowchart LR\n  X --> Y')}`;
    const ids = [...both.matchAll(/(?<!-)\bid="([^"]*)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // Every reference still resolves to an id that is present.
    for (const [, ref] of both.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(ref);
  });

  /* Same source, same markup: the doc view, the deck, and the PDF all render
     from one call each, and a diagram that changed per request would break the
     export cache's only assumption. */
  it('renders the same source the same way twice', () => {
    expect(renderMermaid(FLOW)).toBe(renderMermaid(FLOW));
  });

  it('takes every colour from the golden set, so one render serves both themes', () => {
    const style = /<svg[^>]*style="([^"]*)"/.exec(renderMermaid(FLOW) ?? '')?.[1] ?? '';
    expect(style).toContain('var(--bg-card)');
    expect(style).toContain('var(--fg1)');
    /* A custom property that reads the name it sets is a cycle and computes to
       nothing, which is why none of the mappings may be an identity. */
    for (const [, name, value] of style.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)/g)) {
      expect(value).not.toBe(name);
    }
  });

  it('returns null for a source it cannot draw', () => {
    expect(renderMermaid('pie title Pets\n  "Dogs" : 5')).toBeNull();
    expect(renderMermaid('not a diagram at all')).toBeNull();
  });

  it('escapes a hostile label rather than emitting it', () => {
    const out = renderMermaid('flowchart TD\n  A["</text><script>alert(1)</script>"] --> B[ok]') ?? '';
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('a mermaid fence', () => {
  /* markdown-it hands a fence hook's return back untouched only when it opens
     with `<pre`; anything else it wraps in `<pre><code>`, which would put the
     diagram inside a code block on the deck side alone. */
  it('rides a pre, so the document and the deck get the same markup', () => {
    for (const html of [
      renderMarkdown(fenced(FLOW)),
      renderDeck(`---\nmarp: true\n---\n\n${fenced(FLOW)}`, '').html,
    ]) {
      expect(html).toContain('<pre class="nt-diagram"><svg class="nt-mermaid"');
      expect(html).not.toContain('language-mermaid');
    }
  });

  /* A type this renderer has no layout for must still show its own source. */
  it('falls back to a highlighted code block when the diagram will not draw', () => {
    const html = renderMarkdown(fenced('pie title Pets\n  "Dogs" : 5'));
    expect(html).toContain('class="hljs"');
    expect(html).toContain('pie title Pets');
    expect(html).not.toContain('nt-mermaid');
  });

  it('leaves every other fence to highlight.js', () => {
    expect(renderMarkdown('```js\nconst a = 1;\n```\n')).toContain('class="hljs language-js"');
  });
});
