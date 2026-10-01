import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';

// Golden files: when a visual change is intended, run `npm run examples`
// and review the SVG diffs.
describe('examples', () => {
  it.each(readdirSync('examples').filter((f) => f.endsWith('.estorm')))('%s renders as committed', (f) => {
    const expected = readFileSync(`examples/${f.replace(/\.estorm$/, '.svg')}`, 'utf8');
    expect(render(readFileSync(`examples/${f}`, 'utf8')) + '\n').toBe(expected);
  });
});
