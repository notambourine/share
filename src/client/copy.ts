/* The header's copy button, which every artifact shell carries. Its own module
   because the grid page loads table.js instead of render.js and the button is
   the same button. */

export function wireCopy(): void {
  const copy = document.querySelector('[data-copy]');
  if (!copy) return;
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(location.origin + location.pathname).then(() => {
      copy.textContent = 'copied';
      setTimeout(() => { copy.textContent = 'copy link'; }, 1500);
    });
  });
}
