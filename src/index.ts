/**
 * estorm: a plain-text notation for Event Storming boards, rendered to SVG.
 *
 *   render(text)               estorm text -> SVG string; render(text, { theme: 'dark' | 'auto' })
 *   renderTimeline(text)       the timeline view: events only, sections as swimlanes
 *   parse(text) -> layout(...) -> svg(...)   the same, step by step
 *   parseAll(text)             every parse error at once, and the board without the broken lines
 *   summarize(parse(text))     a Markdown overview of the board
 *   lint(parse(text))          modelling warnings, such as events not in the past tense
 */
import { parse } from './parser.ts';
import { layout } from './layout.ts';
import { timeline } from './timeline.ts';
import { svg } from './svg.ts';
import type { SvgOptions } from './svg.ts';

export { parse, parseAll, ParseError } from './parser.ts';
export type * from './parser.ts';
export { layout } from './layout.ts';
export type { Kind, Lane, Layout, Path, Point, Rect, Sticky } from './layout.ts';
export { timeline } from './timeline.ts';
export { svg, COLORS } from './svg.ts';
export type { SvgOptions, Theme } from './svg.ts';
export { wrap } from './text.ts';
export { summarize } from './summary.ts';
export { lint } from './lint.ts';
export type { Warning } from './lint.ts';

/** Renders estorm text to a standalone SVG document. Throws ParseError. */
export function render(text: string, options?: SvgOptions): string {
  return svg(layout(parse(text)), options);
}

/** Renders the timeline view of estorm text to a standalone SVG document. Throws ParseError. */
export function renderTimeline(text: string, options?: SvgOptions): string {
  return svg(timeline(parse(text)), options);
}
