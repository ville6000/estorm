/**
 * Renders every examples/*.estorm to examples/*.svg. The SVGs are golden
 * files: test/examples.test.ts fails when rendering no longer matches them.
 * Run this after an intended visual change, and review the SVG diffs.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render } from '../src/index.ts';

for (const f of readdirSync('examples').filter((f) => f.endsWith('.estorm'))) {
  const out = `examples/${f.replace(/\.estorm$/, '.svg')}`;
  writeFileSync(out, render(readFileSync(`examples/${f}`, 'utf8')) + '\n');
  console.log(`wrote ${out}`);
}
