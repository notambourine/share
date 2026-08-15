/**
 * Cloudflare Browser Rendering, driven to the free plan's limits.
 *
 * The scarce resource is 10 browser-minutes a day across the whole account,
 * not CPU and not the script cap. Everything here exists to spend fewer of
 * them: reuse a live session instead of launching, take both artifacts from
 * one page load, and give up rather than queue when the account is full.
 *
 * Every failure path returns null. A caller that cannot get a render serves
 * the live client-side shell instead. A missing PDF is a worse day than a
 * broken one.
 */

import puppeteer, { type Browser, type PDFOptions } from '@cloudflare/puppeteer';

/**
 * Cloudflare allows one new browser every 20 seconds. A session that outlives
 * that window means the next request reuses rather than gets refused. Idle
 * keep-alive still bills against the 10 daily minutes, so it stops there.
 */
const KEEP_ALIVE_MS = 30_000;

/** A cold browser plus Marpit plus font loading. Past this, degrade. */
const RENDER_TIMEOUT_MS = 20_000;

export interface Artifacts {
  /** The rendered DOM, self-contained: fonts inlined, scripts removed. */
  html: string;
  pdf: Uint8Array;
}

async function acquire(binding: Fetcher): Promise<Browser | null> {
  /* Reuse across invocations, not just across files in one upload: an upload
     arriving 10 seconds after another cannot open a browser of its own. */
  try {
    for (const session of await puppeteer.sessions(binding)) {
      if (session.connectionId) continue; // another worker is driving it
      try {
        return await puppeteer.connect(binding, session.sessionId);
      } catch { /* raced someone else to it; try the next */ }
    }
  } catch { /* session list is advisory; fall through to a launch */ }

  try {
    const limits = await puppeteer.limits(binding);
    if (limits.allowedBrowserAcquisitions < 1) {
      console.log(`pdf: budget spent, next browser in ${limits.timeUntilNextAllowedBrowserAcquisition}s`);
      return null;
    }
  } catch { /* let launch report the truth instead */ }

  try {
    return await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MS });
  } catch (err) {
    console.log(`pdf: launch failed: ${err}`);
    return null;
  }
}

/**
 * One page load, both artifacts. `page.content()` is the `.html` snapshot and
 * `page.pdf()` is the `.pdf`; rendering twice would double the only budget
 * that binds.
 */
export async function render(binding: Fetcher, html: string, pdfOptions: PDFOptions): Promise<Artifacts | null> {
  const browser = await acquire(binding);
  if (!browser) return null;

  let page: Awaited<ReturnType<Browser['newPage']>> | null = null;
  try {
    page = await browser.newPage();
    await page.setContent(html);
    /* The print HTML flags itself once Marpit, highlight.js, and the fonts
       have all landed. Waiting on a load event would catch none of them. */
    await page.waitForSelector('html[data-ready="1"]', { timeout: RENDER_TIMEOUT_MS });
    const out = await page.content();
    const pdf = await page.pdf(pdfOptions);
    return { html: out, pdf: new Uint8Array(pdf) };
  } catch (err) {
    console.log(`pdf: render failed: ${err}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => { /* the session outlives the page */ });
    /* disconnect, not close: the browser stays warm for the next request
       inside the 20-second new-instance window. */
    try {
      browser.disconnect();
    } catch { /* already gone */ }
  }
}
