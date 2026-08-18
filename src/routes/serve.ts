import type { Env } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import type { ParsedRoute } from '../lib/route';
import { payloadKey, readPayload, readMeta, isExpired } from '../lib/r2';
import { mintToken, parseSigningKeys, verifyToken } from '../lib/sign';
import { verifyAdminToken } from '../lib/admin';
import { viewModeFor } from '../lib/negotiate';
import { explicitMode, isLiveHtml, resolveExport } from '../lib/exportPath';
import { exportArtifact } from './export';
import { rawBytes } from '../lib/bytes';
import { fileShell, dirShell, errorShell, adminShell, type ShellCommon } from '../render/shell';
import { renderCode, renderSource } from '../render/markdown';
import { htmlResponse, now } from '../lib/http';

/** Past this a shell would carry more bytes than a download costs, and
    highlighting them would spend real CPU on a file nobody reads in a browser.
    `?raw` still hands over every byte. */
const MAX_INLINE_BYTES = 1024 * 1024;

/**
 * A markdown source, rendered here rather than in the reader's browser. `mode`
 * null means the content decides, which is the bare `.md` URL; the `.html`
 * spellings pass the mode they pin. Which shell it lands in follows the mode
 * the render resolved, never the one asked for.
 */
async function markdownView(
  env: Env, space: string, hash: string, mode: 'slides' | 'doc' | null, opts: ShellCommon,
): Promise<Response> {
  const text = await readPayload(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  const out = renderSource(text, mode);
  return htmlResponse(out.mode === 'slides'
    ? fileShell(opts, { kind: 'slides', html: out.html, css: out.css })
    : fileShell(opts, { kind: 'md', html: out.html }));
}

async function codeView(
  env: Env, space: string, hash: string, opts: ShellCommon,
): Promise<Response> {
  const text = await readPayload(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  return htmlResponse(fileShell(opts, { kind: 'code', html: renderCode(text, opts.path) }));
}

export async function serve(
  request: Request,
  env: Env,
  route: ParsedRoute,
): Promise<Response> {
  const { space, hash, token, rest } = route;
  const meta = await readMeta(env, space, hash);
  const t = now();
  if (!meta || isExpired(meta, t)) return htmlResponse(errorShell(404), 404);

  const url = new URL(request.url);

  /* A live `?c=` wins the artifact root, checked ahead of the signed-tier 401:
     admin implies view. Invalid, absent, or expired falls through to today's
     view, never a 401 of its own. Root only - a file path ignores c=. */
  if (rest === '') {
    const c = url.searchParams.get('c');
    const keys = c ? parseSigningKeys(env) : null;
    const v = c && keys ? await verifyAdminToken(keys, space, hash, c, t) : null;
    if (v?.ok && keys) {
      /* The page's links must travel, so on the signed tier they ride a fresh
         view token at the /sign default life - the admin holder is the
         uploader, and handing out links is the page's job. */
      const kSeg = meta.tier === 'signed'
        ? `k/${await mintToken(keys, `${space}/${hash}`, t + DEFAULT_LINK_DAYS * 86400)}/`
        : '';
      return htmlResponse(adminShell({ meta, origin: route.origin, kSeg, now: t, adminExp: v.exp }));
    }
  }

  if (meta.tier === 'signed') {
    if (!token) return htmlResponse(errorShell(401), 401);
    const keys = parseSigningKeys(env);
    if (!keys) return htmlResponse(errorShell(401), 401);
    const v = await verifyToken(keys, `${space}/${hash}`, token, t);
    if (!v.ok) return htmlResponse(errorShell(401), 401);
  }

  let filePath = rest;
  if (filePath === '') {
    if (meta.files.some((f) => f.path === 'index.html')) {
      filePath = 'index.html';
    } else {
      return htmlResponse(dirShell(hash, meta.files));
    }
  }

  const file = meta.files.find((f) => f.path === filePath);
  if (!file) {
    /* A poster is not a row of its own, so it resolves off the parent that
       owns it - and always as bytes, because og:image is what asks. */
    if (meta.files.some((f) => f.poster === filePath)) {
      return rawBytes(request, env, payloadKey(space, hash, filePath), filePath, false);
    }
    /* Exact match first, then the format suffixes, so a file uploaded as
       `notes.pdf` serves its own bytes instead of re-rendering `notes`. */
    const wanted = resolveExport(meta.files.map((f) => f.path), filePath);
    if (!wanted) return htmlResponse(errorShell(404), 404);
    const src = meta.files.find((f) => f.path === wanted.source);
    if (!src) return htmlResponse(errorShell(404), 404);
    /* An `.html` spelling is a mode override, not an artifact: it renders here
       and stores nothing, so only `.pdf`, `.png`, and `.txt` reach the export. */
    if (isLiveHtml(wanted.source, wanted.format)) {
      return markdownView(env, space, hash, explicitMode(wanted.format), {
        path: wanted.source,
        rawHref: `${route.dir}${encodeURI(wanted.source)}?raw`,
        size: src.size,
        pageHref: route.page,
      });
    }
    return exportArtifact(request, env, {
      space, hash, url, source: wanted.source, format: wanted.format, size: src.size,
    });
  }

  const mode = viewModeFor(
    filePath, request.headers.get('accept'), url.searchParams, request.headers.get('user-agent'),
  );
  /* Hung off the artifact root, not the request path: the poster is a sibling
     of the file, so a request under a subdirectory would otherwise base it
     wrong. Only the video and svg shells read it. */
  const poster = file.poster ? { posterHref: `${route.root}${encodeURI(file.poster)}?raw` } : {};
  const opts = {
    path: filePath,
    rawHref: `${route.page}${route.page.endsWith('/') ? 'index.html' : ''}?raw`,
    size: file.size,
    pageHref: route.page,
  };

  switch (mode) {
    case 'shell-image': return htmlResponse(fileShell(opts, { kind: 'image' }));
    case 'shell-video': return htmlResponse(fileShell(opts, { kind: 'video', ...poster }));
    case 'shell-svg': return htmlResponse(fileShell(opts, { kind: 'svg', ...poster }));
    /* Both read their bytes to render them, so both fall back to the download
       card rather than inline a file too big to read in a browser anyway. */
    case 'shell-code':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell(opts, { kind: 'download' }))
        : codeView(env, space, hash, opts);
    case 'shell-md':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell(opts, { kind: 'download' }))
        : markdownView(env, space, hash, null, opts);
    case 'shell-download': return htmlResponse(fileShell(opts, { kind: 'download' }));
    default:
      return rawBytes(request, env, payloadKey(space, hash, filePath), filePath, mode === 'attachment');
  }
}
