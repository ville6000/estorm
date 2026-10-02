/**
 * Renders every examples/*.estorm to examples/*.svg, and its timeline view
 * to examples/*.timeline.svg. The SVGs are golden
 * files: test/examples.test.ts fails when rendering no longer matches them.
 * Run this after an intended visual change, and review the SVG diffs.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render, renderTimeline } from '../src/index.ts';

for (const f of readdirSync('examples').filter((f) => f.endsWith('.estorm'))) {
  const text = readFileSync(`examples/${f}`, 'utf8');
  for (const [suffix, convert] of [
    ['.svg', render],
    ['.timeline.svg', renderTimeline],
  ] as const) {
    const out = `examples/${f.replace(/\.estorm$/, suffix)}`;
    writeFileSync(out, convert(text) + '\n');
    console.log(`wrote ${out}`);
  }
}
