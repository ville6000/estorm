import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.ts';
import { trace } from '../src/trace.ts';

const board = parse(
  [
    '== Sales ==', // 1
    '{Cart}',
    'Customer: Place order -> (Order) -> OrderPlaced',
    '  ! Guest checkout?',
    '  after 30 minutes unless PaymentCaptured', // 5
    '    then Cancel unpaid order -> (Order) -> OrderCancelled',
    'Customer: Browse -> Browsed',
    '== Payments ==',
    'when OrderPlaced',
    '  then Charge card -> (Payment) -> [Provider] -> PaymentCaptured', // 10
    '    * Never charge twice',
    'when PaymentCaptured',
    '  then Send receipt -> [Email] -> ReceiptSent',
    'when OrderCancelled',
    '  then Refund -> [Provider] -> Refunded', // 15
  ].join('\n'),
);

/** The trace's sets as sorted arrays, for readable expectations. */
function lines(line: number) {
  const t = trace(board, line);
  if (!t) return null;
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { focus: sorted(t.focus), steps: sorted(t.steps), lines: sorted(t.lines), cancelled: sorted(t.cancelled) };
}

describe('trace', () => {
  it("follows a step's causes back and its effects on, across 'when' and sections", () => {
    expect(lines(10)).toEqual({ focus: [10], steps: [3, 10, 13], lines: [2, 3, 4, 10, 11, 13], cancelled: [6] });
  });

  it("follows effects through 'after', and leaves out what the step doesn't lead to", () => {
    expect(lines(3)).toEqual({
      focus: [3],
      steps: [3, 6, 10, 13, 15],
      lines: [2, 3, 4, 6, 10, 11, 13, 15],
      cancelled: [],
    });
  });

  it('traces the step a read model, hotspot or rule belongs to', () => {
    expect(lines(2)).toEqual(lines(3));
    expect(lines(4)).toEqual(lines(3));
    expect(lines(11)).toEqual(lines(10));
  });

  it("traces the reactions of a 'when' or 'after' on its line", () => {
    expect(lines(9)).toEqual(lines(10));
    expect(lines(5)!.focus).toEqual([6]);
    expect(lines(5)!.steps).toEqual([3, 6, 15]);
  });

  it('is null on a line without a step', () => {
    expect(trace(board, 1)).toBeNull();
    expect(trace(board, 8)).toBeNull();
    expect(trace(board, 99)).toBeNull();
  });

  it('traces events on their own lines, and every step that produces an event', () => {
    const t = trace(parse('Placed\nA: Place -> Placed\nwhen Placed\n  then Ship -> Shipped'), 4)!;
    expect([...t.steps].sort()).toEqual([1, 2, 4]);
  });

  it('ends in a cycle', () => {
    const t = trace(parse('A: Do -> Done\nwhen Done\n  then Redo -> Done'), 1)!;
    expect([...t.steps].sort()).toEqual([1, 3]);
  });
});
