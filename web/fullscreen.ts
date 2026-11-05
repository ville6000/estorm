/**
 * Full screen: the board alone, without the editor, filling the screen. Where
 * the browser can't fill the screen, as on iPhones or in a frame that doesn't
 * allow it, the board fills the window instead. Esc leaves either way.
 */

export interface FullScreen {
  active(): boolean;
}

/** Clicking BUTTON goes full screen or back; ON_CHANGE is called after the board's pane changes size. */
export function fullScreen(button: HTMLElement, onChange: (on: boolean) => void): FullScreen {
  const active = () => document.body.classList.contains('board-only');

  function show(on: boolean): void {
    if (on === active()) return;
    document.body.classList.toggle('board-only', on);
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  }

  button.addEventListener('click', () => {
    if (!active()) {
      show(true);
      if (document.fullscreenEnabled) document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      // Leaving shows the editor again, on fullscreenchange.
      void document.exitFullscreen();
    } else {
      show(false);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) onChange(true);
    else show(false);
  });

  // The browser handles Esc in true full screen; this is for the window-filling fallback.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active() && !document.fullscreenElement) show(false);
  });

  return { active };
}
