/**
 * Branded HTML shells. The Worker emits ~3 kB of markup; highlighting and
 * markdown happen in the browser (public/render.js), so a brand change ships
 * to every artifact ever uploaded without re-rendering anything.
 */

import type { MetaFile } from '../lib/types';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface PageOpts {
  title: string;
  body: string;
  head?: string;
  bodyAttrs?: string;
}

function layout({ title, body, head = '', bodyAttrs = '' }: PageOpts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<title>${esc(title)} · notambourine</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/shell.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${head}
</head>
<body${bodyAttrs}>
<header class="bar">
  <a class="wordmark" href="https://notambourine.com">notambourine</a>
  <span class="eyebrow">share</span>
  <span class="spacer"></span>
  <button class="copy" type="button" data-copy>copy link</button>
</header>
<main class="stage">
${body}
</main>
<script src="/render.js" defer></script>
</body>
</html>`;
}

const HLJS_CSS = '<link rel="stylesheet" href="/vendor/highlight/nt-code.css">';
const HLJS_JS = '<script src="/vendor/highlight/highlight.min.js" defer></script>';
const MARKED_JS = '<script src="/vendor/marked/marked.min.js" defer></script>';
const REVEAL = `<link rel="stylesheet" href="/vendor/reveal/reveal.css">
<link rel="stylesheet" href="/vendor/reveal/nt-reveal.css">
<script src="/vendor/reveal/reveal.js" defer></script>`;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

/** rawHref is the same pathname plus ?raw, so signed /k/ segments ride along. */
export function fileShell(kind: string, path: string, rawHref: string, size?: number): string {
  const name = fileName(path);
  const attrs = ` data-kind="${esc(kind)}" data-raw="${esc(rawHref)}"`;
  switch (kind) {
    case 'image':
      return layout({
        title: name,
        head: `<meta property="og:image" content="${esc(rawHref)}">`,
        bodyAttrs: attrs,
        body: `<figure class="media"><img src="${esc(rawHref)}" alt="${esc(name)}"></figure>
<p class="caption">${esc(name)}${size ? ` · ${fmtSize(size)}` : ''}</p>`,
      });
    case 'video':
      return layout({
        title: name,
        bodyAttrs: attrs,
        body: `<figure class="media"><video controls src="${esc(rawHref)}"></video></figure>
<p class="caption">${esc(name)}${size ? ` · ${fmtSize(size)}` : ''}</p>`,
      });
    case 'svg':
      // Never an inline svg navigation: the image element sandboxes any script.
      return layout({
        title: name,
        bodyAttrs: attrs,
        body: `<figure class="media"><img src="${esc(rawHref)}" alt="${esc(name)}"></figure>
<p class="caption">${esc(name)}${size ? ` · ${fmtSize(size)}` : ''}</p>`,
      });
    case 'code':
      return layout({
        title: name,
        head: HLJS_CSS + HLJS_JS,
        bodyAttrs: attrs,
        body: `<div class="doc code"><p class="caption">${esc(name)}${size ? ` · ${fmtSize(size)}` : ''}</p>
<pre><code id="content">loading…</code></pre></div>`,
      });
    case 'md':
      return layout({
        title: name,
        head: HLJS_CSS + HLJS_JS + MARKED_JS,
        bodyAttrs: attrs,
        body: `<article class="doc prose" id="content"><p class="caption">loading…</p></article>`,
      });
    case 'slides':
      return layout({
        title: name,
        head: MARKED_JS + REVEAL,
        bodyAttrs: attrs,
        body: `<div class="reveal"><div class="slides" id="content"></div></div>`,
      });
    default:
      return layout({
        title: name,
        bodyAttrs: attrs,
        body: `<div class="card download">
<p class="eyebrow">artifact</p>
<h2>${esc(name)}</h2>
<p class="caption">${size ? fmtSize(size) : ''}</p>
<a class="btn" href="${esc(rawHref)}" download="${esc(name)}">download</a>
</div>`,
      });
  }
}

export function dirShell(hash: string, files: MetaFile[]): string {
  const rows = files.map((f) => `<li>
<a href="${encodeURI(f.path)}">${esc(f.path)}</a>
<span class="caption">${fmtSize(f.size)}</span></li>`).join('\n');
  return layout({
    title: hash,
    body: `<div class="doc listing">
<p class="eyebrow">${files.length} ${files.length === 1 ? 'file' : 'files'}</p>
<ul class="files">${rows}</ul>
</div>`,
  });
}

export function errorShell(status: 401 | 404): string {
  const [title, msg] = status === 401
    ? ['This link needs a key', 'Ask whoever sent it for a fresh signed link.']
    : ['Nothing here', 'The link may have expired or been revoked.'];
  return layout({
    title,
    body: `<div class="card">
<p class="eyebrow">${status}</p>
<h2>${esc(title)}</h2>
<p>${esc(msg)}</p>
</div>`,
  });
}
