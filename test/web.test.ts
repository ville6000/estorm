import { describe, expect, it } from 'vitest';
import { ParseError } from '../src/index.ts';
import { errorsHtml, escape, summaryHtml, warningsHtml } from '../web/html.ts';
import { ZOOMS, zoomStep, zoomToFit } from '../web/zoom.ts';

describe('html', () => {
  it('escapes markup', () => {
    expect(escape('<a href="x">&</a>')).toBe('&#60;a href=&#34;x&#34;&#62;&#38;&#60;/a&#62;');
  });

  it('turns the summary Markdown into headings, lists and paragraphs', () => {
    expect(summaryHtml('## Actors\n\n- A <b>\n- B\n\nNo gaps.\n')).toBe(
      '<h3>Actors</h3><ul><li>A &#60;b&#62;</li><li>B</li></ul><p>No gaps.</p>',
    );
  });

  it('lists errors as buttons that jump to their lines', () => {
    expect(errorsHtml([new ParseError(3, 'bad <thing>')])).toBe(
      '<button type="button" data-line="3">line 3: bad &#60;thing&#62;</button>',
    );
    expect(errorsHtml([])).toBe('');
  });

  it('lists warnings under a heading, or nothing without any', () => {
    expect(warningsHtml([{ line: 2, message: 'w' }])).toBe(
      '<h3>Warnings (1)</h3><ul><li><button type="button" data-line="2">line 2: w</button></li></ul>',
    );
    expect(warningsHtml([])).toBe('');
  });
});

describe('zoom', () => {
  it('steps through the levels, stopping at the ends', () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1, -1)).toBe(0.8);
    expect(zoomStep(ZOOMS.at(-1)!, 1)).toBe(ZOOMS.at(-1));
    expect(zoomStep(ZOOMS[0]!, -1)).toBe(ZOOMS[0]);
  });

  it('steps from a level in between, as after fitting', () => {
    expect(zoomStep(0.9, 1)).toBe(1.25);
    expect(zoomStep(0.9, -1)).toBe(0.8);
    expect(zoomStep(5, -1)).toBe(1.5);
  });

  it('fits the width, between 10% and 200%', () => {
    expect(zoomToFit(500, 1000)).toBe(0.5);
    expect(zoomToFit(5000, 100)).toBe(2);
    expect(zoomToFit(10, 1000)).toBe(0.1);
  });
});
