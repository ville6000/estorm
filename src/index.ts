/**
 * estorm: a plain-text notation for Event Storming boards, rendered to SVG.
 *
 *   render(text)               estorm text -> SVG string
 *   parse(text) -> layout(...) -> svg(...)   the same, step by step
 */
import { parse } from './parser.ts';
import { layout } from './layout.ts';
import { svg } from './svg.ts';

export { parse, ParseError } from './parser.ts';
export type * from './parser.ts';
export { layout } from './layout.ts';
export type { Kind, Lane, Layout, Path, Point, Rect, Sticky } from './layout.ts';
export { svg, wrap, COLORS } from './svg.ts';

/** Renders estorm text to a standalone SVG document. Throws ParseError. */
export function render(text: string): string {
  return svg(layout(parse(text)));
}
