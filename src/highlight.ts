/**
 * Syntax highlighting for editors: splits one line of estorm source into
 * tokens. Sticky tokens are named after the sticky they become on the board,
 * so the editor can colour them the same way. Works line by line, like the
 * parser, and never fails: text it doesn't recognise is left plain.
 */
import type { Kind } from './layout.ts';

export type TokenKind = Kind | 'rule' | 'comment' | 'section' | 'keyword' | 'arrow' | 'punct';
export interface Token {
  kind: TokenKind;
  from: number;
  to: number;
}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  /** Adds a token for line[from, to), without surrounding whitespace. */
  const add = (kind: TokenKind, from: number, to: number) => {
    while (from < to && line[from] === ' ') from++;
    while (to > from && line[to - 1] === ' ') to--;
    if (from < to) tokens.push({ kind, from, to });
  };
  /** COMMAND -> ITEM -> … -> EVENT, from START to the end of the line. */
  const chain = (start: number) => {
    const parts = line.slice(start).split('->');
    let at = start;
    parts.forEach((part, i) => {
      const item = part.trim();
      const kind: TokenKind =
        i === 0 ? 'command' : item.startsWith('(') ? 'aggregate' : item.startsWith('[') ? 'external' : 'event';
      add(kind, at, at + part.length);
      at += part.length;
      if (i < parts.length - 1) add('arrow', at, (at += 2));
    });
  };

  const start = line.length - line.trimStart().length;
  const rest = line.slice(start);
  const word = (w: string) => rest.startsWith(w + ' ');
  if (rest.startsWith('#')) {
    add('comment', start, line.length);
  } else if (rest.startsWith('!')) {
    add('hotspot', start, line.length);
  } else if (rest.startsWith('*')) {
    add('rule', start, line.length);
  } else if (rest.startsWith('{')) {
    add('read-model', start, line.length);
  } else if (rest.startsWith('==')) {
    add('section', start, line.length);
  } else if (word('then')) {
    add('keyword', start, start + 4);
    chain(start + 5);
  } else if (word('when')) {
    add('keyword', start, start + 4);
    let at = start + 5;
    for (const comma of [...line.slice(at).matchAll(/,/g)].map((m) => at + m.index)) {
      add('event', at, comma);
      add('punct', comma, comma + 1);
      at = comma + 1;
    }
    add('event', at, line.length);
  } else if (word('after')) {
    add('keyword', start, start + 5);
    const unless = line.indexOf(' unless ', start + 5);
    if (unless === -1) {
      add('schedule', start + 6, line.length);
    } else {
      add('schedule', start + 6, unless);
      add('keyword', unless + 1, unless + 7);
      add('event', unless + 8, line.length);
    }
  } else if (word('every')) {
    add('keyword', start, start + 5);
    const colon = line.lastIndexOf(':');
    if (colon < start + 6) {
      add('schedule', start + 6, line.length);
    } else {
      add('schedule', start + 6, colon);
      add('punct', colon, colon + 1);
      chain(colon + 1);
    }
  } else {
    const colon = line.indexOf(':', start);
    if (colon !== -1) {
      add('actor', start, colon);
      add('punct', colon, colon + 1);
      chain(colon + 1);
    } else if (rest.includes('->')) {
      chain(start);
    } else if (!/[()[\]{}]/.test(rest)) {
      add('event', start, line.length);
    }
  }
  return tokens;
}
