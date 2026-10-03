/**
 * Pan and zoom gestures on the board's scrolling pane: drag to pan with a
 * mouse, pen or finger; pinch, or Ctrl/⌘ and the wheel, to zoom. A drag
 * doesn't count as a click, so clicks still jump to lines.
 */
import { wheelFactor } from './zoom.ts';

/** The board as pan.ts sees it; points are client pixels unless named board. */
export interface BoardView {
  zoom(): number;
  /** The board point, in board pixels, at client X, Y. */
  boardAt(x: number, y: number): Point;
  /** Zooms to ZOOM showing the board point BOARD at client X, Y. */
  place(zoom: number, board: Point, x: number, y: number): void;
}

/** Movement, in pixels, after which a press is a drag rather than a click. */
const DRAG_SLOP = 4;

export interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y) });

/** Safari's pinch on a trackpad; not in the DOM types. */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export function panAndZoom(pane: HTMLElement, view: BoardView): void {
  const pointers = new Map<number, Point>();
  let start: Point | null = null;
  let dragged = false;
  /** Zooms by FACTOR keeping the board point at client X, Y in place. */
  const zoomAt = (factor: number, x: number, y: number) => view.place(view.zoom() * factor, view.boardAt(x, y), x, y);
  /**
   * A pinch as it started. Each step places the board from it, rather than
   * from the last step, so the scroll's rounding to whole pixels doesn't add up.
   */
  let pinch: { zoom: number; distance: number; board: Point } | null = null;
  const startPinch = () => {
    const [a, b] = [...pointers.values()] as [Point, Point];
    const m = middle(a, b);
    pinch = { zoom: view.zoom(), distance: Math.max(1, distance(a, b)), board: view.boardAt(m.x, m.y) };
  };

  pane.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      dragged = false;
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  pane.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      if (!dragged && start && distance(start, now) > DRAG_SLOP) {
        dragged = true;
        // Only now: capturing on press would send the click to the pane instead of the sticky.
        pane.setPointerCapture(e.pointerId);
        pane.classList.add('panning');
      }
      if (dragged) {
        pane.scrollLeft -= now.x - last.x;
        pane.scrollTop -= now.y - last.y;
      }
    } else if (pointers.size === 2 && pinch) {
      pointers.set(e.pointerId, now);
      const [a, b] = [...pointers.values()] as [Point, Point];
      const m = middle(a, b);
      dragged = true;
      view.place((pinch.zoom * distance(a, b)) / pinch.distance, pinch.board, m.x, m.y);
    }
    pointers.set(e.pointerId, now);
  });

  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) pane.classList.remove('panning');
  };
  pane.addEventListener('pointerup', release);
  pane.addEventListener('pointercancel', release);

  // Before the board's own click handlers: a drag ends without a click.
  pane.addEventListener(
    'click',
    (e) => {
      if (dragged) {
        e.stopPropagation();
        dragged = false;
      }
    },
    true,
  );

  pane.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomAt(wheelFactor(e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 * e.deltaY : e.deltaY), e.clientX, e.clientY);
    },
    { passive: false },
  );

  let scale = 1;
  pane.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    scale = 1;
  });
  pane.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const g = e as GestureEvent;
    zoomAt(g.scale / scale, g.clientX, g.clientY);
    scale = g.scale;
  });
}
