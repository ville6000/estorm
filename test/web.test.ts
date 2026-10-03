import { describe, expect, it } from 'vitest';
import { ParseError } from '../src/index.ts';
import { errorsHtml, escape, summaryHtml, warningsHtml } from '../web/html.ts';
import {
  boardAt,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  scrollFor,
  wheelFactor,
  ZOOMS,
  zoomStep,
  zoomToFit,
  zoomToFitArea,
} from '../web/zoom.ts';

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
    expect(zoomStep(5, -1)).toBe(3);
  });

  it('fits the width, between 10% and 200%', () => {
    expect(zoomToFit(500, 1000)).toBe(0.5);
    expect(zoomToFit(5000, 100)).toBe(2);
    expect(zoomToFit(10, 1000)).toBe(0.1);
  });

  it('fits an area by its tighter side', () => {
    expect(zoomToFitArea(1000, 300, 1000, 600)).toBe(0.5);
    expect(zoomToFitArea(5000, 5000, 100, 100)).toBe(2);
  });

  it('keeps free zoom between 10% and 400%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.1)).toBe(1.1);
  });

  it('maps between scroll and board points, at any zoom', () => {
    // 50 px into a pane scrolled by 200, with 16 px padding.
    expect(boardAt(200, 50, 1, 16)).toBe(234);
    expect(boardAt(200, 50, 2, 16)).toBe(117);
    expect(scrollFor(234, 50, 1, 16)).toBe(200);
    expect(scrollFor(boardAt(200, 50, 1.25, 16), 50, 1.25, 16)).toBe(200);
  });

  it('zooms in on wheel up, out on wheel down, by at most a step at a time', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(1000)).toBe(wheelFactor(100));
    expect(wheelFactor(-4)).toBeLessThan(wheelFactor(-100));
  });
});
