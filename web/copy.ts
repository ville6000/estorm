/** Buttons that copy text to the clipboard. */

/** Shows TEXT on BUTTON for a moment, then its label again. */
function flash(button: HTMLButtonElement, text: string): void {
  const label = button.dataset.label ?? (button.dataset.label = button.textContent ?? '');
  button.textContent = text;
  setTimeout(() => (button.textContent = label), 1500);
}

/** Clicking BUTTON copies the text from GET, saying DONE when copied. */
export function copies(button: HTMLButtonElement, get: () => string | Promise<string>, done: string): void {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await get());
      flash(button, done);
    } catch {
      flash(button, 'Copy failed');
    }
  });
}
