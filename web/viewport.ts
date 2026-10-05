/**
 * The board in its scrolling pane: zoom, fit, and fitting a section to the
 * view by clicking its name. Shared by the editor and the live preview.
 */
import { type BoardView, panAndZoom } from './pan.ts';
import { boardAt, clampZoom, scrollFor, zoomStep, zoomToFit, zoomToFitArea } from './zoom.ts';

/** The board's padding, unscaled, around the SVG. */
const BOARD_PAD = 16;

export interface Viewport {
  /** Draws SVG, keeping the zoom and scroll. */
  show(svg: string): void;
  setZoom(zoom: number): void;
  /** Zooms one step in (1) or out (-1). */
  step(direction: 1 | -1): void;
  /** Fits the board's width into the pane. */
  fit(): void;
}

/**
 * The board in PANE, drawn into BOARD, with the zoom shown on ZOOM_LABEL.
 * Wires up pan and zoom gestures and clicks on section names.
 */
export function viewport(pane: HTMLElement, board: HTMLElement, zoomLabel: HTMLElement): Viewport {
  let zoom = 1;
  let size = { width: 0, height: 0 };

  function applyZoom(): void {
    const el = board.querySelector('svg');
    if (el) {
      el.style.width = `${size.width * zoom}px`;
      el.style.height = `${size.height * zoom}px`;
    }
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  /** The board in the pane, for pan and zoom gestures. */
  const view: BoardView = {
    zoom: () => zoom,
    boardAt(x, y) {
      const r = pane.getBoundingClientRect();
      return {
        x: boardAt(pane.scrollLeft, x - r.left, zoom, BOARD_PAD),
        y: boardAt(pane.scrollTop, y - r.top, zoom, BOARD_PAD),
      };
    },
    place(z, at, x, y) {
      const r = pane.getBoundingClientRect();
      zoom = clampZoom(z);
      applyZoom();
      pane.scrollLeft = scrollFor(at.x, x - r.left, zoom, BOARD_PAD);
      pane.scrollTop = scrollFor(at.y, y - r.top, zoom, BOARD_PAD);
    },
  };

  /** Zooms to Z keeping the board point in the middle of the pane in place. */
  function setZoom(z: number): void {
    const r = pane.getBoundingClientRect();
    const x = r.left + 0.5 * pane.clientWidth;
    const y = r.top + 0.5 * pane.clientHeight;
    view.place(z, view.boardAt(x, y), x, y);
  }

  /** Zooms to Z with the board point X, Y (in board pixels) at the top left. */
  function showAt(z: number, x: number, y: number): void {
    zoom = clampZoom(z);
    applyZoom();
    pane.scrollLeft = x * zoom;
    pane.scrollTop = y * zoom;
  }

  /** Fits the lane whose label is LABEL into the pane. */
  function fitLane(label: Element): void {
    const svgEl = board.querySelector('svg')!;
    const at = label.getBoundingClientRect();
    const panel = [...svgEl.querySelectorAll('rect.background')]
      .map((p) => p.getBoundingClientRect())
      .find((p) => p.left <= at.left && at.right <= p.right && p.top <= at.top && at.bottom <= p.bottom);
    if (!panel) return;
    const origin = svgEl.getBoundingClientRect();
    showAt(
      zoomToFitArea(
        pane.clientWidth - 2 * BOARD_PAD,
        pane.clientHeight - 2 * BOARD_PAD,
        panel.width / zoom,
        panel.height / zoom,
      ),
      (panel.left - origin.left) / zoom,
      (panel.top - origin.top) / zoom,
    );
  }

  board.addEventListener('click', (e) => {
    const label = (e.target as Element).closest('.lane');
    if (label) fitLane(label);
  });
  panAndZoom(pane, view);

  return {
    show(svg) {
      board.innerHTML = svg;
      // The SVG's size, not the layout's: the legend can make it bigger.
      const el = board.querySelector('svg')!;
      size = { width: Number(el.getAttribute('width')), height: Number(el.getAttribute('height')) };
      applyZoom();
    },
    setZoom,
    step: (direction) => setZoom(zoomStep(zoom, direction)),
    fit() {
      if (size.width) showAt(zoomToFit(pane.clientWidth - 2 * BOARD_PAD, size.width), 0, 0);
    },
  };
}
