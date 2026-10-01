/** Renders a layout (see layout.ts) as a standalone SVG document. */
import { LANE_LABEL_H, LANE_PAD } from './layout.ts';
import type { Kind, Lane, Layout, Path, Rect, Sticky } from './layout.ts';

export const COLORS: Record<Kind, string> = {
  event: '#ffa94d',
  command: '#74c0fc',
  actor: '#fff3bf',
  policy: '#d0bfff',
  schedule: '#e5dbff',
  aggregate: '#ffd43b',
  external: '#f7a8c8',
  'read-model': '#8ce99a',
  hotspot: '#ff6b6b',
};

const FONT_SIZE = 13;
const LINE_HEIGHT = 16;
const PADDING = 8;

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Attrs = Record<string, string | number | undefined>;

function el(tag: string, attrs: Attrs, children: string | string[] = []): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escape(String(v))}"`)
    .join('');
  const body = Array.isArray(children) ? children.join('') : children;
  return body === '' ? `<${tag}${a}/>` : `<${tag}${a}>${body}</${tag}>`;
}

/**
 * [piece, spaceBefore] pieces of WORD, none longer than MAX_CHARS. Long
 * words split at camel case humps first, e.g. CustomerDetailsFetched.
 */
function splitWord(word: string, maxChars: number): [string, boolean][] {
  const parts =
    word.length <= maxChars
      ? [word]
      : word.split(/(?<=[a-z])(?=[A-Z])/).flatMap((p) => p.match(new RegExp(`.{1,${maxChars}}`, 'gu')) ?? [p]);
  return parts.map((p, i) => [p, i === 0]);
}

/** Greedy word wrap of TEXT into lines of at most MAX_CHARS. */
export function wrap(text: string, maxChars: number): string[] {
  const pieces = text
    .trim()
    .split(/\s+/)
    .flatMap((w) => splitWord(w, maxChars));
  const lines: string[] = [];
  let cur = '';
  for (const [piece, space] of pieces) {
    const joined = cur + (space ? ' ' : '') + piece;
    if (cur === '') cur = piece;
    else if (joined.length <= maxChars) cur = joined;
    else {
      lines.push(cur);
      cur = piece;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

function sticky({ kind, text, line, x, y, w, h }: Sticky): string {
  const maxChars = Math.floor((w - 2 * PADDING) / (0.6 * FONT_SIZE));
  const lines = wrap(text, maxChars);
  const cx = x + 0.5 * w;
  const cy = y + 0.5 * h;
  const top = cy - 0.5 * (lines.length - 1) * LINE_HEIGHT + 0.35 * FONT_SIZE;
  return el(
    'g',
    {
      class: kind,
      'data-line': line,
      transform: kind === 'hotspot' ? `rotate(-3 ${cx} ${cy})` : undefined,
    },
    [
      el('rect', { x, y, width: w, height: h, fill: COLORS[kind], filter: 'url(#shadow)' }),
      el(
        'text',
        { x: cx, y: top, 'text-anchor': 'middle', 'font-size': FONT_SIZE, fill: '#212529' },
        lines.map((l, i) => el('tspan', { x: cx, dy: i === 0 ? 0 : LINE_HEIGHT }, escape(l))),
      ),
    ],
  );
}

function pathD(points: Path): string {
  return 'M' + points.map(([x, y]) => `${x} ${y}`).join(' L');
}

function arrow(points: Path): string {
  return el('path', {
    d: pathD(points),
    fill: 'none',
    stroke: '#868e96',
    'stroke-width': 1.5,
    'marker-end': 'url(#arrow)',
  });
}

/** Arrow of a 'when' reaction, dashed: it may cross a lane boundary. */
function link(points: Path): string {
  return el('path', {
    class: 'link',
    d: pathD(points),
    fill: 'none',
    stroke: '#495057',
    'stroke-width': 1.5,
    'stroke-dasharray': '6 4',
    'marker-end': 'url(#arrow)',
  });
}

/** Arrow from the 'unless' event of an 'after' into the delayed policy: dotted red, it cancels the timer. */
function cancel(points: Path): string {
  return el('path', {
    class: 'cancel',
    d: pathD(points),
    fill: 'none',
    stroke: '#e03131',
    'stroke-width': 1.5,
    'stroke-dasharray': '2 3',
    'marker-end': 'url(#cancel)',
  });
}

function gap({ x, y, w, h }: Rect): string {
  return el('rect', { class: 'gap', x, y, width: w, height: h, fill: '#e9ecef' });
}

function lane({ name, line, x, y }: Lane): string {
  return el('g', { class: 'lane', 'data-line': line }, [
    el(
      'text',
      { x: x + LANE_PAD, y: y + LANE_LABEL_H, 'font-size': 15, 'font-weight': 'bold', fill: '#495057' },
      escape(name),
    ),
  ]);
}

function marker(id: string, color: string): string {
  return el(
    'marker',
    {
      id,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    },
    [el('path', { d: 'M0 0 L10 5 L0 10 z', fill: color })],
  );
}

const DEFS = el('defs', {}, [
  marker('arrow', '#868e96'),
  marker('cancel', '#e03131'),
  el('filter', { id: 'shadow', x: '-10%', y: '-10%', width: '130%', height: '130%' }, [
    el('feDropShadow', { dx: 2, dy: 3, stdDeviation: 2, 'flood-opacity': 0.2 }),
  ]),
]);

/** Layout into a standalone SVG document string. */
export function svg({ width, height, stickies, arrows, links, cancels, lanes, gaps }: Layout): string {
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'font-family': 'system-ui, -apple-system, sans-serif',
    },
    [
      DEFS,
      el('rect', { width: '100%', height: '100%', fill: '#ffffff' }),
      ...gaps.map(gap),
      ...lanes.map(lane),
      ...arrows.map(arrow),
      ...links.map(link),
      ...cancels.map(cancel),
      ...stickies.map(sticky),
    ],
  );
}
