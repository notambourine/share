/**
 * The print page's one job, loaded by the headless browser for the PDF exports:
 * say when the page is safe to typeset.
 *
 * It used to render the markdown too. That moved to the Worker, so the document
 * this runs in is already laid out and the only thing left to wait for is the
 * webfonts - `page.pdf()` before the swap would measure every line against the
 * fallback face.
 */

/* Removing itself is what leaves a document with no JavaScript in it, so a PDF
   can never depend on a script having run against a live origin. */
function stripTransient(): void {
  for (const el of document.querySelectorAll('[data-transient]')) el.remove();
}

stripTransient();

/* The exporter waits on this flag, so it has to be set even if a face never
   arrives: a page typeset in the fallback beats a browser minute spent on a
   timeout. `fonts.ready` resolves either way. */
void document.fonts.ready.then(() => {
  document.documentElement.dataset.ready = '1';
});

/* Nothing to export, but tests/client/print.test.ts imports this for its side
   effects and a script with no import or export is not a module. */
export {};
