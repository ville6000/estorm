/** Zoom levels for the board. */

export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/** The zoom STEP levels from ZOOM: +1 is the next level up, -1 the next down. */
export function zoomStep(zoom: number, step: number): number {
  const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + step))]!;
}

/** The zoom that fits a board WIDTH wide into AVAILABLE pixels, between 10% and 200%. */
export function zoomToFit(available: number, width: number): number {
  return Math.min(2, Math.max(0.1, available / width));
}
