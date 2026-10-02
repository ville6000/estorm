/** Text metrics shared by layout (sticky sizes) and svg (drawing). */

export const FONT_SIZE = 13;
export const LINE_HEIGHT = 16;
export const PADDING = 8;
export const RULE_FONT_SIZE = 11;
export const RULE_LINE_HEIGHT = 14;
/** Room left of a rule's text for its bullet. */
export const BULLET_W = 10;

/** The largest of XS, or FLOOR if none is larger. Math.max(...xs) overflows the stack on big boards. */
export function maxOf(xs: Iterable<number>, floor = -Infinity): number {
  let max = floor;
  for (const x of xs) if (x > max) max = x;
  return max;
}

/** How many characters of FONT_SIZE fit in a sticky of width W. */
export function maxChars(w: number, fontSize = FONT_SIZE): number {
  return Math.floor((w - 2 * PADDING) / (0.6 * fontSize));
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

/**
 * A sticky of width W that lists RULES under its name TEXT: the wrapped
 * lines, and y offsets from its top. A divider separates name and rules.
 */
export interface Ruled {
  name: string[];
  rules: string[][];
  /** Baseline of the first name line. */
  nameY: number;
  dividerY: number;
  /** Baseline of the first rule line. */
  rulesY: number;
  /** Height the text needs. */
  height: number;
}

export function ruled(text: string, rules: string[], w: number): Ruled {
  const name = wrap(text, maxChars(w));
  const lines = rules.map((r) => wrap(r, maxChars(w - BULLET_W, RULE_FONT_SIZE)));
  const dividerY = PADDING + name.length * LINE_HEIGHT + 0.5 * PADDING;
  const ruleCount = lines.reduce((n, l) => n + l.length, 0);
  return {
    name,
    rules: lines,
    nameY: PADDING + 0.8 * LINE_HEIGHT,
    dividerY,
    rulesY: dividerY + 0.5 * PADDING + 0.8 * RULE_LINE_HEIGHT,
    height: dividerY + 0.5 * PADDING + ruleCount * RULE_LINE_HEIGHT + PADDING,
  };
}
