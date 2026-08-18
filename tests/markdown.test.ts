/**
 * The Worker's render pipeline. It runs on every view of a markdown share and
 * inside every PDF, so the two things worth pinning are that the deck and the
 * document agree on the markdown dialect - the bug duplication kept producing -
 * and that nothing from a fence's info string reaches an attribute.
 */

import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderDeck, renderCode } from '../src/render/markdown';

const THEME = '/* @theme nt */\nsection { background: #101014; }\n';

describe('a document', () => {
  it('drops the front matter and keeps the body', () => {
    const out = renderMarkdown('---\ntitle: Notes\nmarp: true\n---\n\n# Heading\n');
    expect(out).toContain('<h1>Heading</h1>');
    expect(out).not.toContain('title: Notes');
  });

  it('renders the GFM the shell always rendered', () => {
    const out = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n');
    expect(out).toContain('<table>');
    expect(out).toContain('<del>gone</del>');
  });

  /* Raw HTML passes through: an upload is Bearer-gated and already runs on this
     origin, which holds no ambient credential. Same contract the old innerHTML
     render had, moved server-side. */
  it('passes raw HTML through', () => {
    expect(renderMarkdown('an <em>inline</em> tag\n')).toContain('<em>inline</em>');
  });
});

describe('code blocks', () => {
  it('highlights a known language and marks it for the theme', () => {
    const out = renderMarkdown('```js\nconst a = 1;\n```\n');
    // nt-code.css keys off `.hljs`, so the class is load-bearing, not decoration.
    expect(out).toContain('class="hljs language-js"');
    expect(out).toContain('hljs-keyword');
  });

  it('leaves an unknown language as escaped text under a bare hljs class', () => {
    const out = renderMarkdown('```nosuchlang\na < b & c\n```\n');
    expect(out).toContain('class="hljs"');
    expect(out).toContain('a &lt; b &amp; c');
  });

  /* The info string is author-controlled, so it only ever reaches the class when
     highlight.js recognised it - which is why no escape is needed there and why
     a hostile fence cannot open an attribute. */
  it('never lets a fence info string reach an attribute', () => {
    const out = renderMarkdown('```"><script>alert(1)</script>\nx\n```\n');
    expect(out).toContain('class="hljs"');
    expect(out).not.toContain('<script>alert(1)</script>');
  });

  it('a code file picks its grammar from the extension', () => {
    expect(renderCode('const a = 1;', 'app.ts')).toContain('language-ts');
    expect(renderCode('plain text', 'notes')).toContain('class="hljs"');
    // The file's own bytes are text, never markup.
    expect(renderCode('<b>x</b>', 'a.unknownext')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('a deck', () => {
  const DECK = '---\nmarp: true\n---\n\n# One\n\n---\n\n# Two\n\n---\n\n# Three\n';

  it('renders one svg per slide, with the theme scoped to them', () => {
    const { html, css } = renderDeck(DECK, THEME);
    expect(html.match(/data-marpit-svg/g)).toHaveLength(3);
    expect(css).toContain('svg[data-marpit-svg]');
  });

  /* An unparseable theme must not cost the deck: Marpit's built-in default still
     renders readable slides. */
  it('falls back to the default theme rather than throwing', () => {
    const { html, css } = renderDeck(DECK, 'section { color: ');
    expect(html).toContain('data-marpit-svg');
    expect(css.length).toBeGreaterThan(0);
  });

  it('renders with no theme at all', () => {
    expect(renderDeck(DECK, '').html).toContain('data-marpit-svg');
  });

  /* Marpit defaults markdown-it to commonmark, which has tables and
     strikethrough off. A deck that read them differently from its own document
     view is the bug two render paths used to produce. */
  it('agrees with the document on tables and highlighting', () => {
    const body = '| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n';
    const { html } = renderDeck(`---\nmarp: true\n---\n\n${body}`, THEME);
    for (const mark of ['<table>', 'class="hljs language-js"', 'hljs-keyword']) {
      expect(html).toContain(mark);
      expect(renderMarkdown(body)).toContain(mark);
    }
  });

  /* The one dialect difference left, measured rather than assumed: markdown-it
     spells strikethrough `<s>` and marked spells it `<del>`. Both strike the
     text, so the page reads the same; matching the tags would mean overriding a
     renderer on one side for no reader-visible gain. */
  it('strikes text through on both sides, under each engine own tag', () => {
    expect(renderDeck('---\nmarp: true\n---\n\n~~gone~~\n', '').html).toContain('<s>gone</s>');
    expect(renderMarkdown('~~gone~~\n')).toContain('<del>gone</del>');
  });
});
