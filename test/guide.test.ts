import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HINTS } from '../src/hints.ts';
import { lint, parseAll } from '../src/index.ts';

const guide = readFileSync('GUIDE.md', 'utf8');
const grammar = readFileSync('GRAMMAR.md', 'utf8');

/** The ```estorm examples in GUIDE.md: boards that must check clean. */
const good = [...guide.matchAll(/```estorm\n([\s\S]*?)```/g)].map((m) => m[1]!);

/** The ```text mistakes in GUIDE.md, with the code named just before each. */
const mistakes = [...guide.matchAll(/\(`([a-z-]+)`\):\s*```text\n([\s\S]*?)```/g)].map((m) => [m[1]!, m[2]!]);

// GUIDE.md teaches AI models the notation, so a wrong example in it
// teaches the wrong thing: these keep it true to the parser.
describe('GUIDE.md', () => {
  it('has examples and mistakes', () => {
    expect(good.length).toBeGreaterThan(5);
    expect(mistakes.length).toBe([...guide.matchAll(/```text\n/g)].length);
  });

  it.each(good)('example checks clean:\n%s', (text) => {
    const { board, errors } = parseAll(text);
    expect(errors).toEqual([]);
    expect(lint(board)).toEqual([]);
  });

  it.each(mistakes)('mistake is the error %s:\n%s', (code, text) => {
    expect(parseAll(text).errors.map((e) => e.code)).toEqual([code]);
  });
});

describe('codes', () => {
  it.each(Object.keys(HINTS))('%s is listed in GRAMMAR.md', (code) => {
    expect(grammar).toContain(`\`${code}\``);
  });
});
