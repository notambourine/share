/**
 * Branded HTML shells. The Worker emits ~3 kB of markup; highlighting and
 * markdown happen in the browser (public/render.js), so a brand change ships
 * to every artifact ever uploaded without re-rendering anything.
 */

import type { Meta, MetaFile } from '../lib/types';
import { kindOf } from '../lib/keys';
import { fileSuffix } from '../lib/link';
import { LOCKUP } from '../brand';

const ESCAPES = new Map([
  ['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;'],
]);

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES.get(c) ?? c);
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* The golden set's icons, served out of public/logo/. The manifest rides the
   landing page alone: every other shell is one client artifact, and a manifest
   there would offer to install that artifact as the NoTambourine app. */
const ICONS = `<link rel="icon" href="/logo/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/logo/export/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/logo/export/apple-touch-icon.png">`;
const MANIFEST = '<link rel="manifest" href="/logo/site.webmanifest">';

interface PageOpts {
  title: string;
  body: string;
  head?: string;
  bodyAttrs?: string;
  /** The landing page: no copy button, no renderer, and its own bare title. */
  home?: boolean;
  /** Replaces the default spacer + copy-button block after the eyebrow. */
  bar?: string;
  /** Page script; the artifact renderer unless a page brings its own. */
  script?: string;
}

function layout({ title, body, head = '', bodyAttrs = '', home = false, bar, script = '/render.js' }: PageOpts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<title>${home ? esc(title) : `${esc(title)} · NoTambourine`}</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/shell.css">
${ICONS}${home ? `\n${MANIFEST}` : ''}
${head}
</head>
<body${bodyAttrs}>
<header class="bar">
  <a class="wordmark" href="https://notambourine.com" aria-label="NoTambourine">${LOCKUP}</a>
  <span class="eyebrow">share</span>
${home ? '' : bar ?? `  <span class="spacer"></span>
  <button class="copy" type="button" data-copy>copy link</button>
`}</header>
<main class="stage">
${body}
</main>
${home ? '' : `<script src="${script}" defer></script>\n`}</body>
</html>`;
}

const HLJS_CSS = '<link rel="stylesheet" href="/vendor/highlight/nt-code.css">';
const HLJS_JS = '<script src="/vendor/highlight/highlight.min.js" defer></script>';
const MARKED_JS = '<script src="/vendor/marked/marked.min.js" defer></script>';
/* No stylesheet link for nt-marp.css: render.js fetches it and hands it to
   Marpit, which scopes it to the slide sections. Linking it too would leak
   bare `section` rules onto the rest of the page. */
const MARP_JS = '<script src="/vendor/marp/marpit.js" defer></script>';

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
        head: HLJS_CSS + HLJS_JS + MARP_JS,
        bodyAttrs: attrs,
        body: `<div class="deck" id="content"></div>
<nav class="deck-nav" hidden>
<button type="button" data-prev aria-label="previous slide">prev</button>
<span class="caption" data-count></span>
<button type="button" data-next aria-label="next slide">next</button>
</nav>`,
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

/**
 * The bare origin. Whoever lands here followed a share link that expired, or
 * trimmed one back to the domain, so the reader is a prospective client and the
 * copy sells the firm rather than the subdomain. Marketing register, so it says
 * "you"; the fixtures it leans on are in the golden set's SKILL.md.
 */
export function homeShell(): string {
  return layout({
    home: true,
    title: 'NoTambourine',
    body: `<div class="card">
<p class="eyebrow">boutique skunkworks engineering</p>
<h2>Senior engineers. No <em>tambourine</em>.</h2>
<p>Your growth is capped by the stack, not by the ambition. We embed with your team as a hands-on operating partner and put the work in prod.</p>
<p>Scope holds, so the estimate is worth something. Tell us what you're building and we'll write back the same day.</p>
<a class="btn" href="https://notambourine.com">See how we work</a>
</div>`,
  });
}

/* ---- admin page (design B; mock: plan/admin-mock, approved 2026-08-16) ---- */

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12"/></svg>';

/* CSS-drawn thumbnails: the shape says what the link is. Landscape = deck,
   portrait text lines = document, mono = source. */
const THUMB_LAND = '<span class="page land"><span class="b accent"></span><span class="b title"></span><span class="b t2"></span></span>';
const THUMB_PORT = '<span class="page port"><span class="b t1"></span><span class="b t2"></span><span class="b t3"></span><span class="b t1"></span><span class="b t2"></span></span>';

interface Tile {
  /** Path under the artifact root (already URI-encoded), plus any query. */
  target: string;
  label: string;
  sub: string;
  thumb: string;
  fmt?: string;
  /** Derived render this tile waits on, keyed by source path; admin.js polls
      the status route and paints the state. `html` means either mode's html. */
  status?: { src: string; awaits: string };
}

function srcThumb(text: string): string {
  return `<span class="srctext">${esc(text)}</span>`;
}

function mdStem(path: string): string {
  return path.replace(/\.(md|markdown)$/i, '');
}

/** The mock's five, per markdown source. Tile targets under the shipped
    grammar; none carry `c=`. */
function mdTiles(path: string, tag: string): Tile[] {
  const stem = encodeURI(mdStem(path));
  return [
    { target: `${stem}.slides.html`, label: `${tag}deck`, sub: 'every slide, scroll through', thumb: THUMB_LAND, status: { src: path, awaits: 'slides.html' } },
    { target: `${stem}.slides.pdf`, label: `${tag}deck pdf`, sub: 'for email attachments', thumb: THUMB_LAND, fmt: 'pdf', status: { src: path, awaits: 'slides.pdf' } },
    { target: `${stem}.doc.pdf`, label: `${tag}document pdf`, sub: 'same words, one page after another', thumb: THUMB_PORT, fmt: 'pdf', status: { src: path, awaits: 'doc.pdf' } },
    { target: `${stem}.html`, label: `${tag}offline copy`, sub: 'one file, fonts inside, no server', thumb: THUMB_LAND, fmt: 'html', status: { src: path, awaits: 'html' } },
    { target: `${stem}.txt`, label: `${tag}source`, sub: 'the markdown itself', thumb: srcThumb('---\nmarp: true\n---\n# the plan') },
  ];
}

/** Tiles are global to the artifact: one group for the thing you'd send.
    A folder with an index.html reads as one site, never a tile per asset. */
function tilesFor(meta: Meta): Tile[] {
  if (meta.files.some((f) => f.path === 'index.html')) {
    return [{ target: '', label: 'site', sub: 'the uploaded page, everything inside', thumb: THUMB_LAND, fmt: 'html' }];
  }
  const tiles: Tile[] = [];
  for (const f of meta.files) {
    // One upload, several files: the stem keys which tile belongs to which.
    const tag = meta.files.length > 1 ? `${fileName(f.path)} · ` : '';
    const encoded = encodeURI(f.path);
    switch (kindOf(f.path)) {
      case 'md':
        tiles.push(...mdTiles(f.path, meta.files.length > 1 ? `${fileName(mdStem(f.path))} · ` : ''));
        break;
      case 'image':
        tiles.push(
          { target: encoded, label: `${tag}page`, sub: 'branded page, opens in a tab', thumb: THUMB_LAND, fmt: 'img' },
          { target: `${encoded}?raw`, label: `${tag}hotlink`, sub: 'the bytes, for img src and unfurls', thumb: srcThumb(`<img src=\n"${fileName(f.path)}">`) },
        );
        break;
      case 'code':
      case 'other':
        tiles.push({ target: encoded, label: fileName(f.path), sub: 'branded page, opens in a tab', thumb: srcThumb(fileName(f.path)) });
        break;
      default: // video, svg, html
        tiles.push({ target: encoded, label: fileName(f.path), sub: 'branded page, opens in a tab', thumb: THUMB_LAND });
    }
  }
  return tiles;
}

function tileHtml(base: string, t: Tile): string {
  const status = t.status ? ` data-src="${esc(t.status.src)}" data-await="${esc(t.status.awaits)}"` : '';
  return `<a class="tile" href="${base}${t.target}" target="_blank" rel="noopener"${status}>
<span class="thumb">${t.thumb}${t.fmt ? `<span class="fmt">${esc(t.fmt)}</span>` : ''}</span>
<span class="tlabel"><span class="t">${esc(t.label)}</span><span class="s">${esc(t.sub)}</span>${t.status ? '<span class="tstate"></span>' : ''}</span>
<button class="copyicon" type="button" data-copy-href aria-label="copy link">${COPY_ICON}</button>
</a>`;
}

function fmtLeft(secs: number): string {
  if (secs >= 86400) return `${Math.ceil(secs / 86400)}d`;
  if (secs >= 3600) return `${Math.ceil(secs / 3600)}h`;
  return `${Math.max(1, Math.ceil(secs / 60))}m`;
}

function expiryText(meta: Meta, t: number): string {
  if (meta.expiresAt !== null) return `expires in ${fmtLeft(meta.expiresAt - t)}`;
  if (meta.idleTtl !== null) return `expires ${fmtLeft(meta.idleTtl)} after last visit`;
  return 'never expires';
}

/** Which chip the stored expiry already is; null presses none. */
function pressedTtl(meta: Meta): string | null {
  if (meta.expiresAt === null) return meta.idleTtl === null ? 'forever' : null;
  const secs = meta.expiresAt - meta.createdAt;
  return [7, 30, 90].map((d) => `${d}d`).find((d) => secs === Number.parseInt(d, 10) * 86400) ?? null;
}

/** The locked fs-index: the uploaded files plus each markdown's spellings. */
function lockedRows(meta: Meta, base: string): string {
  const row = (target: string, name: string, note: string) =>
    `<tr><td><a href="${base}${target}">${esc(name)}</a></td><td>${esc(note)}</td></tr>`;
  const rows: string[] = [];
  const site = meta.files.some((f) => f.path === 'index.html');
  for (const f of meta.files) {
    rows.push(row(encodeURI(f.path), f.path, fmtSize(f.size)));
    if (!site && kindOf(f.path) === 'md') {
      const stem = mdStem(f.path);
      const enc = encodeURI(stem);
      rows.push(
        row(`${enc}.pdf`, `${stem}.pdf`, 'pdf'),
        row(`${enc}.slides.html`, `${stem}.slides.html`, 'deck'),
        row(`${enc}.html`, `${stem}.html`, 'offline'),
        row(`${enc}.txt`, `${stem}.txt`, 'source'),
      );
    }
  }
  return rows.join('\n');
}

export interface AdminView {
  meta: Meta;
  origin: string;
  /** `k/<viewtoken>/` on the signed tier, '' on the open tier. The tiles'
      links must travel, so they ride a view token, never this page's `?c=`. */
  kSeg: string;
  now: number;
}

/**
 * The admin page: format tiles, TTL chips, delete. Served only behind a live
 * `?c=` (src/routes/serve.ts); the token itself appears nowhere in the markup -
 * public/admin.js reads it from location.search and calls the write routes.
 * The locked block is the client-side degrade when the countdown dies.
 */
export function adminShell(view: AdminView): string {
  const { meta, origin, kSeg, now: t } = view;
  const base = `${origin}/${meta.space}/${meta.hash}/${kSeg}`;
  const artifact = `${meta.space}/${meta.hash}`;
  const single = meta.files.length === 1 ? meta.files[0] : null;
  const bytes = meta.files.reduce((n, f) => n + f.size, 0);
  const clientLink = `${base}${fileSuffix(meta)}`;
  const remint = `nt-share admin ${artifact}`;
  const reput = `nt-share put ${meta.space}${single ? ` ${single.path}` : ''}`;
  const pressed = pressedTtl(meta);
  const chips = ['7d', '30d', '90d', 'forever'].map((d) =>
    `<button class="chip" type="button" data-ttl="${d}" aria-pressed="${d === pressed}">${d}</button>`).join('\n');

  const body = `<div class="admin-wrap">
<div class="filehead">
<h1>${esc(single ? fileName(single.path) : meta.hash)}</h1>
<span class="path">${esc(artifact)} · ${meta.files.length} ${meta.files.length === 1 ? 'file' : 'files'} · ${fmtSize(bytes)} · <span data-exp>${expiryText(meta, t)}</span></span>
</div>
<div class="admin-only" id="admin">
<div class="actions" id="actions">
<p class="confirmtext">The live link dies within 10 minutes, not instantly.
Then re-upload: <code>${esc(reput)}</code></p>
<button class="abtn abtn-primary idle-only" type="button" data-copylink data-url="${clientLink}">copy link</button>
<button class="abtn abtn-ghost idle-only" type="button" data-arm>delete</button>
<button class="abtn abtn-primary arm-only" type="button" data-fire>yes, delete it</button>
<button class="abtn abtn-ghost arm-only" type="button" data-disarm>keep it</button>
</div>
<div class="tiles">
${tilesFor(meta).map((tile) => tileHtml(base, tile)).join('\n')}
</div>
<p class="note">Click a card to open it in a new tab; the corner icon copies its link.
None of these carry this page's token.</p>
${single ? '' : `<ul class="files">
${meta.files.map((f) => `<li><a href="${base}${encodeURI(f.path)}">${esc(f.path)}</a><span class="caption">${fmtSize(f.size)}</span></li>`).join('\n')}
</ul>
`}<div class="cols">
<div class="panel">
<p class="cardlabel">expiry</p>
<div class="chiprow">
${chips}
</div>
<p class="note">Counts from upload. Links you already sent inherit the change.</p>
</div>
<div class="panel">
<p class="cardlabel">this page</p>
<p class="note">Works for 5 minutes; each edit restarts the clock. After that
this URL falls back to the plain view. Re-open:</p>
<code class="cmd">${esc(remint)}</code>
</div>
</div>
</div>
<div class="locked-only">
<div class="panel">
<p class="cardlabel">index</p>
<table class="index-table">
${lockedRows(meta, base)}
</table>
<p class="note">The admin window for this page has closed. Everything above keeps
serving; to change the expiry or delete the share, re-open the admin link:</p>
<code class="cmd">${esc(remint)}</code>
</div>
</div>
</div>`;

  return layout({
    title: `${single ? fileName(single.path) : meta.hash} · admin`,
    bodyAttrs: ' class="admin"',
    bar: `  <span class="pill pill-admin admin-only">admin</span>
  <span class="spacer"></span>
  <span class="pill admin-only" data-countdown></span>
`,
    script: '/admin.js',
    body,
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
