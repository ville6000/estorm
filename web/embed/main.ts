/**
 * The live preview page editors embed: shows the board the editor sends,
 * keeps the last good one (dimmed) while the text doesn't parse, pans and
 * zooms (../pan.ts), and asks the editor to show a sticky's line when it is
 * clicked. Builds its own DOM, so a host only has to load preview.css,
 * define window.estormHost and load this. The messages are in src/embed.ts.
 */
import type { Host, PreviewError, ToPage } from '../../src/embed.ts';
import { type BoardView, panAndZoom } from '../pan.ts';
import { boardAt, clampZoom, MIN_ZOOM, scrollFor, zoomStep, zoomToFitArea } from '../zoom.ts';
import './style.css';

declare global {
  interface Window {
    estormHost?: Host;
  }
}

const host: Host = window.estormHost ?? { post: (msg) => console.log('estorm preview:', msg) };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) {
  return Object.assign(document.createElement(tag), props);
}

const board = element('div', { className: 'board' });
const diagram = element('div', { className: 'diagram' });
const errors = element('div', { className: 'errors', hidden: true });
const zoomOut = element('button', { type: 'button', title: 'Zoom out', textContent: '−' });
const zoomLabel = element('button', { type: 'button', title: 'Actual size', className: 'zoom' });
const zoomIn = element('button', { type: 'button', title: 'Zoom in', textContent: '+' });
const fit = element('button', { type: 'button', title: 'Fit to width', textContent: 'Fit' });
const toolbar = element('div', { className: 'toolbar' });
toolbar.append(zoomOut, zoomLabel, zoomIn, fit);
board.append(diagram);
document.body.append(board, toolbar, errors);

/** A zoom factor, or 'fit' to scale the board to the width of the page. */
let zoom: number | 'fit' = 'fit';

const svgElement = () => diagram.querySelector('svg');
const naturalWidth = () => Number(svgElement()?.getAttribute('width')) || 0;
/** Padding around the board, in .diagram in style.css. */
const PADDING = 16;
const currentScale = () => {
  if (zoom !== 'fit') return zoom;
  const room = board.clientWidth - 2 * PADDING;
  return naturalWidth() > 0 ? Math.max(MIN_ZOOM, Math.min(1, room / naturalWidth())) : 1;
};

function applyZoom(): void {
  const svg = svgElement();
  if (svg) {
    svg.style.width = `${naturalWidth() * currentScale()}px`;
    svg.style.height = 'auto';
  }
  zoomLabel.textContent = `${Math.round(currentScale() * 100)}%`;
  fit.classList.toggle('active', zoom === 'fit');
}

/** The board in the pane, for pan and zoom gestures. */
const view: BoardView = {
  zoom: currentScale,
  boardAt(x, y) {
    const r = board.getBoundingClientRect();
    const scale = currentScale();
    return {
      x: boardAt(board.scrollLeft, x - r.left, scale, PADDING),
      y: boardAt(board.scrollTop, y - r.top, scale, PADDING),
    };
  },
  place(scale, point, x, y) {
    const r = board.getBoundingClientRect();
    zoom = clampZoom(scale);
    applyZoom();
    board.scrollLeft = scrollFor(point.x, x - r.left, zoom, PADDING);
    board.scrollTop = scrollFor(point.y, y - r.top, zoom, PADDING);
  },
};

/** Zooms to SCALE, keeping the board point in the middle of the pane where it is. */
function zoomTo(scale: number): void {
  const r = board.getBoundingClientRect();
  const x = r.left + board.clientWidth / 2;
  const y = r.top + board.clientHeight / 2;
  view.place(scale, view.boardAt(x, y), x, y);
}

/** The next zoom level in DIRECTION, never the wrong way from below the lowest level. */
function step(direction: 1 | -1): number {
  const now = currentScale();
  const next = zoomStep(now, direction);
  return direction > 0 ? Math.max(now, next) : Math.min(now, next);
}

/** Fits the section whose name is LABEL into the pane. */
function fitSection(label: Element): void {
  const svg = svgElement();
  if (!svg) return;
  const at = label.getBoundingClientRect();
  const section = [...svg.querySelectorAll('rect.background')]
    .map((p) => p.getBoundingClientRect())
    .find((p) => p.left <= at.left && at.right <= p.right && p.top <= at.top && at.bottom <= p.bottom);
  if (!section) return;
  const origin = svg.getBoundingClientRect();
  const scale = currentScale();
  zoom = zoomToFitArea(
    board.clientWidth - 2 * PADDING,
    board.clientHeight - 2 * PADDING,
    section.width / scale,
    section.height / scale,
  );
  applyZoom();
  board.scrollLeft = ((section.left - origin.left) / scale) * zoom;
  board.scrollTop = ((section.top - origin.top) / scale) * zoom;
}

zoomIn.addEventListener('click', () => zoomTo(step(1)));
zoomOut.addEventListener('click', () => zoomTo(step(-1)));
zoomLabel.addEventListener('click', () => zoomTo(1));
fit.addEventListener('click', () => {
  zoom = 'fit';
  applyZoom();
});
panAndZoom(board, view);
window.addEventListener('resize', applyZoom);

diagram.addEventListener('click', (e) => {
  const label = (e.target as Element).closest('.lane');
  if (label) fitSection(label);
  const line = Number((e.target as Element).closest('[data-line]')?.getAttribute('data-line'));
  if (line > 0) host.post({ type: 'reveal', line });
});
errors.addEventListener('click', (e) => {
  const line = Number((e.target as Element).closest('[data-line]')?.getAttribute('data-line'));
  if (line > 0) host.post({ type: 'reveal', line });
});

/** Lists LIST in the error bar, each error a button that shows its line. */
function showErrors(list: PreviewError[]): void {
  errors.replaceChildren(
    ...list.map(({ line, message }) => {
      const button = element('button', {
        type: 'button',
        textContent: line > 0 ? `line ${line}: ${message}` : message,
      });
      button.dataset.line = String(line);
      return button;
    }),
  );
  errors.hidden = list.length === 0;
}

window.addEventListener('message', (e: MessageEvent<ToPage>) => {
  const msg = e.data;
  switch (msg?.type) {
    case 'render':
      diagram.innerHTML = msg.svg;
      diagram.classList.remove('stale');
      showErrors([]);
      applyZoom();
      break;
    case 'errors':
      showErrors(msg.errors);
      diagram.classList.add('stale');
      break;
    case 'state':
      host.setState?.(msg.state);
      break;
  }
});

applyZoom();
host.post({ type: 'ready' });
