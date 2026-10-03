/** Zoom levels for the board. */

export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];

/** Free zooming, with the wheel or a pinch, stays between these. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The zoom STEP levels from ZOOM: +1 is the next level up, -1 the next down. */
export function zoomStep(zoom: number, step: number): number {
  const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + step))]!;
}

/** The zoom that fits a board WIDTH wide into AVAILABLE pixels, between 10% and 200%. */
export function zoomToFit(available: number, width: number): number {
  return Math.min(2, Math.max(MIN_ZOOM, available / width));
}

/** The zoom that fits a W by H area into AVAILABLE_W by AVAILABLE_H pixels, between 10% and 200%. */
export function zoomToFitArea(availableW: number, availableH: number, w: number, h: number): number {
  return Math.min(2, Math.max(MIN_ZOOM, Math.min(availableW / w, availableH / h)));
}

/*
 * Along one axis, a pane scrolled by SCROLL shows the board point (in board
 * pixels) BOARD at AT pixels from its edge. PAD is the unscaled space before
 * the board.
 */

/** The board point at AT pixels from the pane's edge. */
export function boardAt(scroll: number, at: number, zoom: number, pad: number): number {
  return (scroll + at - pad) / zoom;
}

/** The scroll that shows the board point BOARD at AT pixels from the pane's edge. */
export function scrollFor(board: number, at: number, zoom: number, pad: number): number {
  return board * zoom + pad - at;
}

/**
 * How much a wheel event of DELTA pixels zooms: a mouse wheel notch about
 * 20%, a trackpad pinch a little per event. Up zooms in.
 */
export function wheelFactor(delta: number): number {
  return Math.exp(-0.01 * Math.max(-25, Math.min(25, delta)));
}
