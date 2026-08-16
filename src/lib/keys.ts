/** Slugs, upload-path safety, extension -> kind/content-type. Pure functions, unit tested. */

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Top-level path segments the router owns; a space may not take these names. */
export const RESERVED = new Set([
  'up', 'sign', 'session', 'z', 'k', 'f', 'd', '_trash',
  'llms.txt', 'SKILL.md', 'robots.txt', 'favicon.ico', 'favicon.svg',
  'apple-touch-icon.png', 'apple-touch-icon-precomposed.png',
  'tokens.css', 'shell.css', 'print.css', 'render.js', 'vendor', 'index.html',
  'fonts', 'logo',
]);

/** 12 base62 chars ≈ 71 bits. Rejection sampling keeps the distribution uniform. */
export function genSlug(len = 12): string {
  let out = '';
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < len) out += BASE62[b % 62];
    }
  }
  return out;
}

export function isValidSpace(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(s) && !RESERVED.has(s);
}

export function isValidHash(s: string): boolean {
  return /^[A-Za-z0-9]{12}$/.test(s);
}

/**
 * Normalize an uploaded file path into a safe R2 key suffix.
 * Returns null to reject the whole upload: fail loudly rather than mangle.
 */
export function normalizeUploadPath(raw: string): string | null {
  if (!raw || raw.length > 512) return null;
  let p = raw.replace(/\\/g, '/');
  if (p.startsWith('/')) return null;
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    // Control bytes must never reach an R2 key, so matching them is the point.
    // oxlint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f?#]/.test(seg)) return null;
    if (seg.length > 255) return null;
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  if (parts[0] === 'meta.json' || parts[0] === 'f' || parts[0] === 'k' || parts[0] === 'd') {
    // f/ holds the payload, d/ the derived exports, k/ is the signed-token
    // segment, meta.json is the record.
    return null;
  }
  return parts.join('/');
}

export type Kind = 'image' | 'video' | 'svg' | 'md' | 'html' | 'code' | 'other';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'bmp']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'css', 'scss',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'sh', 'bash', 'zsh', 'sql', 'yaml', 'yml', 'toml', 'xml', 'ini', 'txt',
  'diff', 'patch', 'graphql', 'proto', 'tf', 'dockerfile', 'log', 'csv',
]);

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base.toLowerCase() === 'dockerfile' ? 'dockerfile' : '';
  return base.slice(dot + 1).toLowerCase();
}

export function kindOf(path: string): Kind {
  const ext = extOf(path);
  if (IMAGE.has(ext)) return 'image';
  if (VIDEO.has(ext)) return 'video';
  if (ext === 'svg') return 'svg';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (CODE.has(ext)) return 'code';
  return 'other';
}

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', jsonc: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8', pdf: 'application/pdf',
  yaml: 'text/plain; charset=utf-8', yml: 'text/plain; charset=utf-8',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  woff2: 'font/woff2', woff: 'font/woff',
  mp3: 'audio/mpeg', wav: 'audio/wav',
};

export function contentTypeFor(path: string): string {
  const ext = extOf(path);
  if (TYPES[ext]) return TYPES[ext];
  if (kindOf(path) === 'code') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** "90d" | "12h" | "30m" | "forever" -> seconds (0 = forever). null = unparseable. */
export function parseDuration(raw: string): number | null {
  if (raw === 'forever') return 0;
  const m = /^(\d+)([mhdw])$/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as 'm' | 'h' | 'd' | 'w'];
  const secs = n * unit;
  if (secs <= 0 || secs > 100 * 365 * 86400) return null;
  return secs;
}
