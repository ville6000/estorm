/**
 * Picks out a trace (src/trace.ts) on the drawn board: everything outside it
 * fades, and the stickies of the traced step get a ring. Works on both views,
 * through the source lines the SVG gives each sticky (data-line) and the ends
 * of each arrow (data-from, data-to).
 */
import type { Trace } from '../src/trace.ts';

/** Shows T on the board drawn in BOARD, or clears it when T is null. */
export function showTrace(board: HTMLElement, t: Trace | null): void {
  board.classList.toggle('tracing', t !== null);
  for (const el of board.querySelectorAll('.traced, .focus')) el.classList.remove('traced', 'focus');
  if (!t) return;
  for (const g of board.querySelectorAll<SVGGElement>('svg g[data-line]:not(.lane)')) {
    const line = Number(g.dataset.line);
    // An 'unless' cancels a delayed reaction's timer, its policy, not what the reaction does.
    const cancelled = g.classList.contains('policy') && t.cancelled.has(line);
    g.classList.toggle('traced', t.lines.has(line) || cancelled);
    g.classList.toggle('focus', t.focus.has(line));
  }
  for (const path of board.querySelectorAll<SVGPathElement>('svg path[data-from]')) {
    const to = Number(path.dataset.to);
    const into = t.steps.has(to) || (path.classList.contains('cancel') && t.cancelled.has(to));
    path.classList.toggle('traced', t.steps.has(Number(path.dataset.from)) && into);
  }
}
