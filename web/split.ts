/**
 * The bar between the editor and the board: drag it, or focus it and use the
 * arrow keys, to give the editor more or less of the workspace; double-click
 * it for the default size again. Side by side it moves sideways; stacked, on
 * narrow screens, up and down. The size is kept for next time.
 */
import * as prefs from './prefs.ts';

/** Neither pane gets smaller than this, in pixels; style.css has the same. */
export const MIN_PANE = 160;

/** How far an arrow key moves the bar, as a share of the workspace. */
const KEY_STEP = 0.02;

/**
 * The editor's share of a workspace SIZE pixels long, with the bar AT pixels
 * from its start, leaving both panes at least MIN_PANE.
 */
export function editorShare(at: number, size: number): number {
  return Math.max(MIN_PANE, Math.min(at, size - MIN_PANE)) / size;
}

/** Makes BAR resize EDITOR, the first pane of WORKSPACE. */
export function splitter(bar: HTMLElement, workspace: HTMLElement, editor: HTMLElement): void {
  const stacked = matchMedia('(max-width: 760px)');
  let dragging = false;

  /** Where the workspace starts and how long it is, along the way the bar moves. */
  function axis(): { start: number; size: number } {
    const r = workspace.getBoundingClientRect();
    return stacked.matches ? { start: r.top, size: r.height } : { start: r.left, size: r.width };
  }

  /** The editor's share of the workspace as drawn. */
  function current(): number {
    const r = editor.getBoundingClientRect();
    return (stacked.matches ? r.height : r.width) / axis().size;
  }

  function describe(): void {
    bar.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
    bar.setAttribute('aria-valuenow', String(Math.round(current() * 100)));
  }

  /** Gives the editor SHARE of the workspace, or its default size for null. */
  function resize(share: number | null): void {
    if (share === null) workspace.style.removeProperty('--editor-size');
    else workspace.style.setProperty('--editor-size', `${(share * 100).toFixed(2)}%`);
    describe();
  }

  function moveTo(e: PointerEvent): void {
    const { start, size } = axis();
    resize(editorShare((stacked.matches ? e.clientY : e.clientX) - start, size));
  }

  bar.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  bar.addEventListener('pointermove', (e) => {
    if (dragging) moveTo(e);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing');
    prefs.saveEditorSize(current());
  };
  bar.addEventListener('pointerup', release);
  bar.addEventListener('pointercancel', release);

  bar.addEventListener('dblclick', () => {
    resize(null);
    prefs.saveEditorSize(null);
  });

  bar.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const { size } = axis();
    const share = editorShare((current() + step * KEY_STEP) * size, size);
    resize(share);
    prefs.saveEditorSize(share);
  });

  stacked.addEventListener('change', describe);
  resize(prefs.loadEditorSize());
}
