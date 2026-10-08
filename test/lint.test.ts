import { describe, expect, it } from 'vitest';
import { lint, parse } from '../src/index.ts';
import { isPastTense } from '../src/lint.ts';

const warnings = (text: string) => lint(parse(text));

describe('isPastTense', () => {
  it.each(['OrderPlaced', 'Order placed', 'GuestCheckedOut', 'RoomMarkedDirty', 'DueDateSet', 'DepositTaken'])(
    'accepts %s',
    (name) => expect(isPastTense(name)).toBe(true),
  );

  it('accepts irregular participles with a prefix', () => {
    expect(isPastTense('InvoiceRepaid')).toBe(true);
    expect(isPastTense('Report rewritten')).toBe(true);
  });

  it.each(['PlaceOrder', 'Place order', 'RoomAvailable', 'ReservationReady', 'Shipping'])('rejects %s', (name) =>
    expect(isPastTense(name)).toBe(false),
  );
});

describe('lint', () => {
  it('is empty for a well-named board', () => {
    expect(warnings('A: Do -> Done\n  then Ship -> (Order) -> Shipped')).toEqual([]);
  });

  it('checks each of several events', () => {
    expect(warnings('A: Do -> Done, Fail')).toEqual([{ line: 1, message: 'event should be in the past tense: Fail' }]);
  });

  it('flags each event not in the past tense once, at its first line', () => {
    expect(warnings('Ready\nA: Start -> (X) -> Begin\n  then Go -> Ready\nwhen Begin\n  then Go -> Gone')).toEqual([
      { line: 1, message: 'event should be in the past tense: Ready' },
      { line: 2, message: 'event should be in the past tense: Begin' },
    ]);
  });

  it('flags events in reactions, including delayed ones', () => {
    expect(warnings('A: Do -> Done\n  after 1 day\n    then Remind -> Reminder')).toEqual([
      { line: 3, message: 'event should be in the past tense: Reminder' },
    ]);
  });

  it('flags an aggregate used in several contexts, at its first use in the second', () => {
    const text = [
      '== Sales ==',
      'A: Place -> (Order) -> Placed',
      '== Payments ==',
      'when Placed',
      '  then Charge -> [Bank] -> Charged',
      '== Warehouse ==',
      'when Charged',
      '  then Pack -> (Order) -> Packed',
      '== Sales ==',
      'B: Cancel -> (Order) -> Cancelled',
    ].join('\n');
    expect(warnings(text)).toEqual([
      { line: 8, message: 'aggregate Order is used in several contexts: Sales, Warehouse' },
    ]);
  });

  it('ignores aggregates outside contexts and external systems', () => {
    expect(warnings('A: Do -> (Order) -> [Bank] -> Done\n== Sales ==\nB: Go -> (Order) -> [Bank] -> Gone')).toEqual([]);
  });
});
