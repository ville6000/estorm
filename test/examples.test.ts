import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lint, parse, render } from '../src/index.ts';

const boards = readdirSync('examples').filter((f) => f.endsWith('.estorm'));

// Golden files: when a visual change is intended, run `npm run examples`
// and review the SVG diffs.
describe('examples', () => {
  it.each(boards)('%s renders as committed', (f) => {
    const expected = readFileSync(`examples/${f.replace(/\.estorm$/, '.svg')}`, 'utf8');
    expect(render(readFileSync(`examples/${f}`, 'utf8')) + '\n').toBe(expected);
  });

  it.each(boards)('%s lints clean', (f) => {
    expect(lint(parse(readFileSync(`examples/${f}`, 'utf8')))).toEqual([]);
  });
});
