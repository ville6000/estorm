/** Renders a layout (see layout.ts) as a standalone SVG document. */
import { LANE_LABEL_H, LANE_PAD } from './layout.ts';
import type { Kind, Lane, Layout, Path, Rect, Sticky } from './layout.ts';
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
}

/** Colours of everything but the stickies, which keep theirs (and dark text) in both themes. */
interface Palette {
  background: string;
  gap: string;
  lane: string;
  arrow: string;
  link: string;
  cancel: string;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    background: '#ffffff',
    gap: '#e9ecef',
    lane: '#495057',
    arrow: '#868e96',
    link: '#495057',
    cancel: '#e03131',
  },
  dark: {
    background: '#1a1b1e',
    gap: '#2c2e33',
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
      ` .estorm .gap { fill: ${p.gap} }` +
      ` .estorm .lane text { fill: ${p.lane} }` +
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

function gap({ x, y, w, h }: Rect, p: Palette): string {
  return el('rect', { class: 'gap', x, y, width: w, height: h, fill: p.gap });
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

/** Layout into a standalone SVG document string, light unless OPTIONS say otherwise. */
export function svg(
  { width, height, stickies, arrows, links, cancels, lanes, gaps }: Layout,
  { theme = 'light' }: SvgOptions = {},
): string {
  const p = PALETTES[theme === 'dark' ? 'dark' : 'light'];
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
      el('rect', { class: 'background', width: '100%', height: '100%', fill: p.background }),
      ...gaps.map((g) => gap(g, p)),
      ...lanes.map((l) => lane(l, p)),
      ...arrows.map((a) => arrow(a, p)),
      ...links.map((l) => link(l, p)),
      ...cancels.map((c) => cancel(c, p)),
      ...stickies.map(sticky),
    ],
  );
}
