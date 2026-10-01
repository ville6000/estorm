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
    expect(doc).toContain('class="gap"');
  });

  it('draws cancels', () => {
    const doc = render('A: Do -> Done\n  after 1 day unless Gone\n    then B -> BDone\nX: Go -> Gone');
    expect(doc).toContain('class="cancel"');
  });
});
