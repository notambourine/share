import { describe, expect, it } from 'vitest';
import {
  genSlug, isValidSpace, isValidHash, normalizeUploadPath,
  extOf, kindOf, contentTypeFor, parseDuration,
} from '../src/lib/keys';

describe('genSlug', () => {
  it('emits the requested length from base62 only', () => {
    for (let i = 0; i < 50; i++) {
      expect(genSlug(12)).toMatch(/^[A-Za-z0-9]{12}$/);
    }
    expect(genSlug(8)).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it('does not repeat across a small sample', () => {
    const seen = new Set(Array.from({ length: 200 }, () => genSlug(12)));
    expect(seen.size).toBe(200);
  });
});

describe('space and hash validation', () => {
  it('accepts plain slugs', () => {
    expect(isValidSpace('acme')).toBe(true);
    expect(isValidSpace('sara-2')).toBe(true);
  });
  it('rejects reserved router names', () => {
    for (const r of ['up', 'sign', 'z', 'vendor', 'robots.txt', 'logo', 'fonts']) {
      expect(isValidSpace(r)).toBe(false);
    }
  });
  it('rejects casing, dots, and length abuse', () => {
    expect(isValidSpace('Acme')).toBe(false);
    expect(isValidSpace('a.b')).toBe(false);
    expect(isValidSpace('-lead')).toBe(false);
    expect(isValidSpace('a'.repeat(33))).toBe(false);
  });
  it('hash is exactly 12 base62 chars', () => {
    expect(isValidHash('Ab3dEf6hIj9k')).toBe(true);
    expect(isValidHash('short')).toBe(false);
    expect(isValidHash('Ab3dEf6hIj9k2')).toBe(false);
    expect(isValidHash('Ab3dEf6hIj9!')).toBe(false);
  });
});

describe('normalizeUploadPath', () => {
  it('keeps clean relative paths', () => {
    expect(normalizeUploadPath('report.png')).toBe('report.png');
    expect(normalizeUploadPath('assets/css/app.css')).toBe('assets/css/app.css');
    expect(normalizeUploadPath('./deck.md')).toBe('deck.md');
    expect(normalizeUploadPath('a//b.txt')).toBe('a/b.txt');
  });
  it('rejects traversal and absolute paths', () => {
    expect(normalizeUploadPath('../etc/passwd')).toBeNull();
    expect(normalizeUploadPath('a/../../b')).toBeNull();
    expect(normalizeUploadPath('/etc/passwd')).toBeNull();
    expect(normalizeUploadPath('a\\..\\b')).toBeNull();
  });
  it('rejects names that shadow the record or the router', () => {
    expect(normalizeUploadPath('meta.json')).toBeNull();
    expect(normalizeUploadPath('f/anything.txt')).toBeNull();
    expect(normalizeUploadPath('k/anything.txt')).toBeNull();
    // d/ holds the derived exports; an upload landing there could pose as one.
    expect(normalizeUploadPath('d/deck.md.pdf')).toBeNull();
    expect(normalizeUploadPath('d')).toBeNull();
    expect(normalizeUploadPath('deck/d/notes.md')).toBe('deck/d/notes.md');
    expect(normalizeUploadPath('meta.json2')).toBe('meta.json2');
    expect(normalizeUploadPath('sub/meta.json')).toBe('sub/meta.json');
  });
  it('rejects control characters and URL-breaking chars', () => {
    expect(normalizeUploadPath('a\nb.txt')).toBeNull();
    expect(normalizeUploadPath('a?b.txt')).toBeNull();
    expect(normalizeUploadPath('a#b.txt')).toBeNull();
    expect(normalizeUploadPath('with space.txt')).toBe('with space.txt');
  });
  it('rejects empty and oversized', () => {
    expect(normalizeUploadPath('')).toBeNull();
    expect(normalizeUploadPath('.')).toBeNull();
    expect(normalizeUploadPath('x'.repeat(600))).toBeNull();
  });
});

describe('kind and content type', () => {
  it('classifies by extension', () => {
    expect(kindOf('shot.png')).toBe('image');
    expect(kindOf('demo.mp4')).toBe('video');
    expect(kindOf('logo.svg')).toBe('svg');
    expect(kindOf('notes.md')).toBe('md');
    expect(kindOf('index.html')).toBe('html');
    expect(kindOf('main.ts')).toBe('code');
    expect(kindOf('Dockerfile')).toBe('code');
    expect(kindOf('report.pdf')).toBe('other');
  });
  it('maps content types with charsets on text', () => {
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('a.md')).toBe('text/markdown; charset=utf-8');
    expect(contentTypeFor('a.rs')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('a.blob')).toBe('application/octet-stream');
  });
  it('extOf handles dotfiles and nesting', () => {
    expect(extOf('a/b/c.TS')).toBe('ts');
    expect(extOf('.gitignore')).toBe('');
    expect(extOf('noext')).toBe('');
  });
});

describe('parseDuration', () => {
  it('parses units and forever', () => {
    expect(parseDuration('90d')).toBe(90 * 86400);
    expect(parseDuration('12h')).toBe(12 * 3600);
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('2w')).toBe(2 * 604800);
    expect(parseDuration('forever')).toBe(0);
  });
  it('rejects junk', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('90')).toBeNull();
    expect(parseDuration('-3d')).toBeNull();
    expect(parseDuration('3y')).toBeNull();
    expect(parseDuration('0d')).toBeNull();
  });
});
