import { describe, expect, it } from 'vitest';
import { acceptsHtml, viewModeFor } from '../src/lib/negotiate';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8';
const IMG_TAG = 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
const CURL = '*/*';

const q = (s = '') => new URLSearchParams(s);

describe('acceptsHtml', () => {
  it('address bar yes, img tag and curl no', () => {
    expect(acceptsHtml(BROWSER)).toBe(true);
    expect(acceptsHtml(IMG_TAG)).toBe(false);
    expect(acceptsHtml(CURL)).toBe(false);
    expect(acceptsHtml(null)).toBe(false);
  });
});

describe('viewModeFor', () => {
  it('image: shell for browsers, raw for hotlinks', () => {
    expect(viewModeFor('shot.png', BROWSER, q())).toBe('shell-image');
    expect(viewModeFor('shot.png', IMG_TAG, q())).toBe('raw');
    expect(viewModeFor('shot.png', CURL, q())).toBe('raw');
  });

  it('?raw and ?view override Accept', () => {
    expect(viewModeFor('shot.png', BROWSER, q('raw'))).toBe('raw');
    expect(viewModeFor('shot.png', CURL, q('view'))).toBe('shell-image');
  });

  it('code highlights in browser, plain elsewhere', () => {
    expect(viewModeFor('main.ts', BROWSER, q())).toBe('shell-code');
    expect(viewModeFor('main.ts', CURL, q())).toBe('raw');
  });

  it('markdown renders, ?slides runs the deck', () => {
    expect(viewModeFor('deck.md', BROWSER, q())).toBe('shell-md');
    expect(viewModeFor('deck.md', BROWSER, q('slides'))).toBe('shell-slides');
    expect(viewModeFor('deck.md', CURL, q())).toBe('raw');
  });

  it('html is the page itself everywhere; ?view=source highlights', () => {
    expect(viewModeFor('index.html', BROWSER, q())).toBe('page');
    expect(viewModeFor('index.html', CURL, q())).toBe('page');
    expect(viewModeFor('index.html', BROWSER, q('view=source'))).toBe('shell-code');
  });

  it('svg never serves inline: shell in browser, attachment raw', () => {
    expect(viewModeFor('logo.svg', BROWSER, q())).toBe('shell-svg');
    expect(viewModeFor('logo.svg', CURL, q())).toBe('attachment');
    expect(viewModeFor('logo.svg', BROWSER, q('raw'))).toBe('attachment');
  });

  it('unknown types get a download card or an attachment', () => {
    expect(viewModeFor('report.pdf', BROWSER, q())).toBe('shell-download');
    expect(viewModeFor('report.pdf', CURL, q())).toBe('attachment');
  });

  it('video: shell in browser, raw bytes for players', () => {
    expect(viewModeFor('demo.mp4', BROWSER, q())).toBe('shell-video');
    expect(viewModeFor('demo.mp4', 'video/*', q())).toBe('raw');
  });
});
