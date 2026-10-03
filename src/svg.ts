/** Renders a layout (see layout.ts) as a standalone SVG document. */
import { LANE_LABEL_H, LANE_PAD } from './layout.ts';
import type { Kind, Lane, Layout, Path, Sticky } from './layout.ts';
import {
  BULLET_W,
  FONT_SIZE,
  LINE_HEIGHT,
  maxChars,
  PADDING,
  RULE_FONT_SIZE,
  RULE_LINE_HEIGHT,
  ruled,
  wrap,
} from './text.ts';

export { wrap } from './text.ts';

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

/** 'auto' follows the viewer's prefers-color-scheme. */
export type Theme = 'light' | 'dark' | 'auto';

export interface SvgOptions {
  theme?: Theme;
  /** A key to the sticky colours and arrow styles on the board, below it. On by default. */
  legend?: boolean;
}

/** Names in the legend, in the order a flow reads. */
const KIND_NAMES: [Kind, string][] = [
  ['actor', 'Actor'],
  ['schedule', 'Schedule'],
  ['read-model', 'Read model'],
  ['policy', 'Policy'],
  ['command', 'Command'],
  ['aggregate', 'Aggregate'],
  ['external', 'External system'],
  ['event', 'Event'],
  ['hotspot', 'Hotspot'],
];

const LEGEND_FONT_SIZE = 12;
const LEGEND_ROW_H = 24;
const SWATCH = 14;
/** Length of an arrow sample. */
const LINE_SAMPLE = 28;
/** Between a sample and its name, and between items. */
const LEGEND_GAP = 6;
const LEGEND_ITEM_GAP = 20;
/** A narrow board's legend may be wider than the board, up to this. */
const LEGEND_MIN_W = 480;
/** Inside the legend's box, around its items. */
const LEGEND_PAD_X = 16;
const LEGEND_PAD_Y = 8;
/** Between the legend's box and the board. */
const LEGEND_SPACE = 32;

/** Colours of everything but the stickies, which keep theirs (and dark text) in both themes. */
interface Palette {
  background: string;
  lane: string;
  arrow: string;
  link: string;
  cancel: string;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#ffffff',
    lane: '#495057',
    arrow: '#868e96',
    link: '#495057',
    cancel: '#e03131',
  },
  dark: {
    background: '#1a1b1e',
    lane: '#c1c2c5',
    arrow: '#909296',
    link: '#a6a7ab',
    cancel: '#ff6b6b',
  },
};

const STICKY_TEXT = '#212529';

/** Dark overrides for theme 'auto', scoped to .estorm so an inlined SVG leaves the page alone. */
function darkStyle(p: Palette): string {
  return el(
    'style',
    {},
    '@media (prefers-color-scheme: dark) {' +
      ` .estorm .background { fill: ${p.background} }` +
      ` .estorm .lane text { fill: ${p.lane} }` +
      ` .estorm .legend text { fill: ${p.lane} }` +
      ` .estorm .arrow { stroke: ${p.arrow} }` +
      ` .estorm .link { stroke: ${p.link} }` +
      ` .estorm .cancel { stroke: ${p.cancel} }` +
      ` .estorm #arrow path { fill: ${p.arrow} }` +
      ` .estorm #cancel path { fill: ${p.cancel} }` +
      ' }',
  );
}

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

function sticky(s: Sticky): string {
  const { kind, text, line, x, y, w, h } = s;
  const cx = x + 0.5 * w;
  const cy = y + 0.5 * h;
  return el(
    'g',
    {
      class: kind,
      'data-line': line,
      transform: kind === 'hotspot' ? `rotate(-3 ${cx} ${cy})` : undefined,
    },
    [
      el('rect', { x, y, width: w, height: h, fill: COLORS[kind], filter: 'url(#shadow)' }),
      ...(s.rules?.length ? ruledText(s) : [centredText(s)]),
    ],
  );
}

function centredText({ text, x, y, w, h }: Sticky): string {
  const lines = wrap(text, maxChars(w));
  const cx = x + 0.5 * w;
  const top = y + 0.5 * h - 0.5 * (lines.length - 1) * LINE_HEIGHT + 0.35 * FONT_SIZE;
  return el(
    'text',
    { x: cx, y: top, 'text-anchor': 'middle', 'font-size': FONT_SIZE, fill: STICKY_TEXT },
    lines.map((l, i) => el('tspan', { x: cx, dy: i === 0 ? 0 : LINE_HEIGHT }, escape(l))),
  );
}

/** The name at the top, then a divider, then each rule as a bullet. */
function ruledText({ text, rules, x, y, w }: Sticky): string[] {
  const r = ruled(text, rules!, w);
  const cx = x + 0.5 * w;
  const left = x + PADDING;
  let ry = y + r.rulesY;
  const bullets = r.rules.map((lines) => {
    const out = el('g', { class: 'rule' }, [
      el('text', { x: left, y: ry, 'font-size': RULE_FONT_SIZE, fill: STICKY_TEXT }, '•'),
      el(
        'text',
        { x: left + BULLET_W, y: ry, 'font-size': RULE_FONT_SIZE, fill: STICKY_TEXT },
        lines.map((l, i) => el('tspan', { x: left + BULLET_W, dy: i === 0 ? 0 : RULE_LINE_HEIGHT }, escape(l))),
      ),
    ]);
    ry += lines.length * RULE_LINE_HEIGHT;
    return out;
  });
  return [
    el(
      'text',
      {
        x: cx,
        y: y + r.nameY,
        'text-anchor': 'middle',
        'font-size': FONT_SIZE,
        'font-weight': 'bold',
        fill: STICKY_TEXT,
      },
      r.name.map((l, i) => el('tspan', { x: cx, dy: i === 0 ? 0 : LINE_HEIGHT }, escape(l))),
    ),
    el('line', {
      x1: left,
      x2: x + w - PADDING,
      y1: y + r.dividerY,
      y2: y + r.dividerY,
      stroke: STICKY_TEXT,
      'stroke-opacity': 0.3,
    }),
    ...bullets,
  ];
}

function pathD(points: Path): string {
  return 'M' + points.map(([x, y]) => `${x} ${y}`).join(' L');
}

function arrow(points: Path, p: Palette): string {
  return el('path', {
    class: 'arrow',
    d: pathD(points),
    fill: 'none',
    stroke: p.arrow,
    'stroke-width': 1.5,
    'marker-end': 'url(#arrow)',
  });
}

/** Arrow of a 'when' reaction, dashed: it may cross a lane boundary. */
function link(points: Path, p: Palette): string {
  return el('path', {
    class: 'link',
    d: pathD(points),
    fill: 'none',
    stroke: p.link,
    'stroke-width': 1.5,
    'stroke-dasharray': '6 4',
    'marker-end': 'url(#arrow)',
  });
}

/** Arrow from the 'unless' event of an 'after' into the delayed policy: dotted red, it cancels the timer. */
function cancel(points: Path, p: Palette): string {
  return el('path', {
    class: 'cancel',
    d: pathD(points),
    fill: 'none',
    stroke: p.cancel,
    'stroke-width': 1.5,
    'stroke-dasharray': '2 3',
    'marker-end': 'url(#cancel)',
  });
}

function lane({ name, line, x, y }: Lane, p: Palette): string {
  return el('g', { class: 'lane', 'data-line': line }, [
    el(
      'text',
      { x: x + LANE_PAD, y: y + LANE_LABEL_H, 'font-size': 15, 'font-weight': 'bold', fill: p.lane },
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

function defs(p: Palette): string {
  return el('defs', {}, [
    marker('arrow', p.arrow),
    marker('cancel', p.cancel),
    el('filter', { id: 'shadow', x: '-10%', y: '-10%', width: '130%', height: '130%' }, [
      el('feDropShadow', { dx: 2, dy: 3, stdDeviation: 2, 'flood-opacity': 0.2 }),
    ]),
  ]);
}

interface LegendItem {
  name: string;
  /** Draws the sample at X, centred on Y. */
  sample: (x: number, y: number) => string;
  sampleW: number;
}

/** Legend items for the sticky kinds and arrow styles in LAYOUT, and none for what it lacks. */
function legendItems({ stickies, arrows, links, cancels }: Layout, p: Palette): LegendItem[] {
  const kinds = new Set(stickies.map((s) => s.kind));
  const swatch = (kind: Kind) => (x: number, y: number) =>
    el('rect', { x, y: y - 0.5 * SWATCH, width: SWATCH, height: SWATCH, fill: COLORS[kind] });
  const line = (draw: (points: Path, p: Palette) => string) => (x: number, y: number) =>
    draw(
      [
        [x, y],
        [x + LINE_SAMPLE, y],
      ],
      p,
    );
  return [
    ...KIND_NAMES.filter(([kind]) => kinds.has(kind)).map(([kind, name]) => ({
      name,
      sample: swatch(kind),
      sampleW: SWATCH,
    })),
    ...(arrows.length ? [{ name: 'Flow', sample: line(arrow), sampleW: LINE_SAMPLE }] : []),
    ...(links.length ? [{ name: 'Reaction (when)', sample: line(link), sampleW: LINE_SAMPLE }] : []),
    ...(cancels.length ? [{ name: 'Cancel (unless)', sample: line(cancel), sampleW: LINE_SAMPLE }] : []),
  ];
}

/**
 * The legend above LAYOUT, outside its lanes: items left to right, wrapping
 * into rows, on a box of the background colour only as wide as they need.
 * It may be wider than the board on narrow boards.
 */
function legend(layout: Layout, p: Palette): { body: string; width: number; height: number } {
  const items = legendItems(layout, p);
  if (!items.length) return { body: '', width: 0, height: 0 };
  const right = Math.max(layout.width, LEGEND_MIN_W) - LEGEND_PAD_X;
  const out: string[] = [];
  let x = LEGEND_PAD_X;
  let row = 0;
  let width = 0;
  for (const { name, sample, sampleW } of items) {
    const w = sampleW + LEGEND_GAP + name.length * 0.55 * LEGEND_FONT_SIZE;
    if (x > LEGEND_PAD_X && x + w > right) {
      x = LEGEND_PAD_X;
      row++;
    }
    const y = LEGEND_PAD_Y + (row + 0.5) * LEGEND_ROW_H;
    out.push(
      sample(x, y),
      el(
        'text',
        { x: x + sampleW + LEGEND_GAP, y: y + 0.35 * LEGEND_FONT_SIZE, 'font-size': LEGEND_FONT_SIZE, fill: p.lane },
        escape(name),
      ),
    );
    width = Math.max(width, x + w + LEGEND_PAD_X);
    x += w + LEGEND_ITEM_GAP;
  }
  width = Math.ceil(width);
  const boxH = (row + 1) * LEGEND_ROW_H + 2 * LEGEND_PAD_Y;
  return {
    body: el('g', { class: 'legend' }, [
      el('rect', { class: 'background', width, height: boxH, fill: p.background }),
      ...out,
    ]),
    width,
    height: boxH + LEGEND_SPACE,
  };
}

/** Layout into a standalone SVG document string, light unless OPTIONS say otherwise. */
export function svg(layout: Layout, { theme = 'light', legend: withLegend = true }: SvgOptions = {}): string {
  const { stickies, arrows, links, cancels, lanes, panels } = layout;
  const p = PALETTES[theme === 'dark' ? 'dark' : 'light'];
  const key = withLegend ? legend(layout, p) : { body: '', width: 0, height: 0 };
  const width = Math.max(layout.width, key.width);
  const height = layout.height + key.height;
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      class: theme === 'auto' ? 'estorm' : undefined,
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'font-family': 'system-ui, -apple-system, sans-serif',
    },
    [
      ...(theme === 'auto' ? [darkStyle(PALETTES.dark)] : []),
      defs(p),
      key.body,
      // The board moves down to make room for the legend.
      el('g', { transform: key.height ? `translate(0 ${key.height})` : undefined }, [
        ...panels.map(({ x, y, w, h }) =>
          el('rect', { class: 'background', x, y, width: w, height: h, fill: p.background }),
        ),
        ...lanes.map((l) => lane(l, p)),
        ...arrows.map((a) => arrow(a, p)),
        ...links.map((l) => link(l, p)),
        ...cancels.map((c) => cancel(c, p)),
        ...stickies.map(sticky),
      ]),
    ],
  );
}
