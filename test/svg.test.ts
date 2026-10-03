import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';
import { wrap } from '../src/svg.ts';

describe('wrap', () => {
  it('wraps at word boundaries', () => {
    expect(wrap('Fetch customer details', 17)).toEqual(['Fetch customer', 'details']);
  });

  it('breaks long words at camel case humps', () => {
    expect(wrap('CustomerDetailsFetched', 17)).toEqual(['CustomerDetails', 'Fetched']);
  });

  it('then breaks hard', () => {
    expect(wrap('aaaaaaaaaaaa', 5)).toEqual(['aaaaa', 'aaaaa', 'aa']);
  });

  it('returns no lines for empty text', () => {
    expect(wrap('', 10)).toEqual([]);
  });
});

describe('svg', () => {
  const doc = render('A: Do <it> -> Done & dusted');

  it('is a standalone SVG document', () => {
    expect(doc.startsWith('<svg')).toBe(true);
    expect(doc).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('escapes text', () => {
    expect(doc).toContain('Do &lt;it&gt;');
    expect(doc).toContain('Done &amp; dusted');
  });

  it('keeps source lines', () => {
    expect(doc).toContain('data-line="1"');
  });

  it('draws lanes and links', () => {
    const doc = render('== Sales ==\nA: Do -> Done\n== Billing ==\nwhen Done\n  then B -> BDone');
    expect(doc).toContain('>Billing</text>');
    expect(doc).toContain('class="link"');
    expect(doc.match(/class="background"/g)).toHaveLength(3); // the legend's, and one per lane
  });

  it('lists rules inside their aggregate', () => {
    const doc = render('A: Do -> (Order) -> Done\n  * Total & tax > 0');
    expect(doc).toContain('class="rule"');
    expect(doc).toContain('Total &amp; tax &gt; 0');
  });

  it('draws cancels', () => {
    const doc = render('A: Do -> Done\n  after 1 day unless Gone\n    then B -> BDone\nX: Go -> Gone');
    expect(doc).toContain('class="cancel"');
  });
});

describe('themes', () => {
  const text = '== Sales ==\nA: Do -> Done\n== Billing ==\nwhen Done\n  then B -> BDone';

  it('is light by default, without a stylesheet', () => {
    const doc = render(text);
    expect(doc).toMatch(/class="background" width="\d+" height="\d+" fill="#ffffff"/);
    expect(doc).not.toContain('<style');
  });

  it('draws dark boards with the same sticky colours', () => {
    const doc = render(text, { theme: 'dark' });
    expect(doc).toContain('fill="#1a1b1e"');
    expect(doc).toContain('fill="#ffa94d"');
    expect(doc).not.toContain('<style');
  });

  it('follows the colour scheme on auto, scoped to the board', () => {
    const doc = render(text, { theme: 'auto' });
    expect(doc).toContain('class="estorm"');
    expect(doc).toContain('fill="#ffffff"');
    expect(doc).toContain('@media (prefers-color-scheme: dark)');
    expect(doc).toContain('.estorm .background { fill: #1a1b1e }');
  });
});

describe('legend', () => {
  const names = (doc: string) =>
    [...(doc.match(/<g class="legend">.*?<\/g>/)?.[0] ?? '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  it('lists the sticky kinds and arrow styles on the board, in flow order', () => {
    const doc = render('A: Do -> (Order) -> Done\n  after 1 day unless Gone\n    then B -> BDone\nX: Go -> Gone');
    expect(names(doc)).toEqual(['Actor', 'Policy', 'Command', 'Aggregate', 'Event', 'Flow', 'Cancel (unless)']);
  });

  it('lists when links', () => {
    const doc = render('== Sales ==\nA: Do -> Done\n== Billing ==\nwhen Done\n  then B -> BDone');
    expect(names(doc)).toContain('Reaction (when)');
  });

  it('adds to the height and, on narrow boards, the width', () => {
    const board = render('Done', { legend: false });
    const doc = render('Done');
    const size = (d: string) =>
      d
        .match(/width="(\d+)" height="(\d+)"/)!
        .slice(1)
        .map(Number);
    expect(size(doc)[1]).toBeGreaterThan(size(board)[1]!);
    expect(size(doc)[0]).toBeGreaterThanOrEqual(size(board)[0]!);
  });

  it('goes above the board, which moves down to make room', () => {
    const doc = render('A: Do -> Done');
    expect(doc.indexOf('class="legend"')).toBeLessThan(doc.indexOf('class="actor"'));
    expect(doc).toMatch(/<g transform="translate\(0 \d+\)">/);
    expect(render('A: Do -> Done', { legend: false })).not.toContain('translate(');
  });

  it('has a background only as wide as its items', () => {
    const doc = render('Done ' + 'Then '.repeat(8));
    const box = doc.match(/<g class="legend"><rect class="background" width="(\d+)"/);
    const board = doc.match(/<g transform[^>]*><rect class="background" x="0" y="0" width="(\d+)"/);
    expect(Number(box![1])).toBeLessThan(Number(board![1]));
  });

  it('can be left out', () => {
    expect(render('A: Do -> Done', { legend: false })).not.toContain('class="legend"');
  });

  it('is left out of empty boards', () => {
    expect(render('')).not.toContain('class="legend"');
  });

  it('follows the colour scheme on auto', () => {
    expect(render('A: Do -> Done', { theme: 'auto' })).toContain('.estorm .legend text { fill: #c1c2c5 }');
  });
});
