import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/highlight.ts';

/** [kind, text] pairs, for readable expectations. */
const tokens = (line: string) => tokenize(line).map((t) => [t.kind, line.slice(t.from, t.to)]);

describe('tokenize', () => {
  it('splits a flow into actor, command, chain items and event', () => {
    expect(tokens('Customer: Place order -> (Order) -> [Stripe] -> OrderPlaced')).toEqual([
      ['actor', 'Customer'],
      ['punct', ':'],
      ['command', 'Place order'],
      ['arrow', '->'],
      ['aggregate', '(Order)'],
      ['arrow', '->'],
      ['external', '[Stripe]'],
      ['arrow', '->'],
      ['event', 'OrderPlaced'],
    ]);
  });

  it('marks then as a keyword followed by a chain', () => {
    expect(tokens('  then Ship -> Shipped')).toEqual([
      ['keyword', 'then'],
      ['command', 'Ship'],
      ['arrow', '->'],
      ['event', 'Shipped'],
    ]);
  });

  it('marks the event of when', () => {
    expect(tokens('when PaymentCaptured')).toEqual([
      ['keyword', 'when'],
      ['event', 'PaymentCaptured'],
    ]);
  });

  it('marks each event of a when on several', () => {
    expect(tokens('when Paid, Shipped')).toEqual([
      ['keyword', 'when'],
      ['event', 'Paid'],
      ['punct', ','],
      ['event', 'Shipped'],
    ]);
  });

  it('marks each event at the end of a chain', () => {
    expect(tokens('Do -> (Order) -> Paid, Failed')).toEqual([
      ['command', 'Do'],
      ['arrow', '->'],
      ['aggregate', '(Order)'],
      ['arrow', '->'],
      ['event', 'Paid'],
      ['punct', ','],
      ['event', 'Failed'],
    ]);
  });

  it('splits after into duration and optional unless event', () => {
    expect(tokens('  after 30 days unless Paid')).toEqual([
      ['keyword', 'after'],
      ['schedule', '30 days'],
      ['keyword', 'unless'],
      ['event', 'Paid'],
    ]);
    expect(tokens('  after 30 days')).toEqual([
      ['keyword', 'after'],
      ['schedule', '30 days'],
    ]);
  });

  it('ends a schedule at the last colon', () => {
    expect(tokens('every night at 02:00: Clean up -> CleanedUp')).toEqual([
      ['keyword', 'every'],
      ['schedule', 'night at 02:00'],
      ['punct', ':'],
      ['command', 'Clean up'],
      ['arrow', '->'],
      ['event', 'CleanedUp'],
    ]);
    expect(tokens('every day:Clean up -> CleanedUp')).toEqual([
      ['keyword', 'every'],
      ['schedule', 'day'],
      ['punct', ':'],
      ['command', 'Clean up'],
      ['arrow', '->'],
      ['event', 'CleanedUp'],
    ]);
  });

  it('marks whole-line statements', () => {
    expect(tokens('# note')).toEqual([['comment', '# note']]);
    expect(tokens('  ! Why?')).toEqual([['hotspot', '! Why?']]);
    expect(tokens('  * Never overbooked')).toEqual([['rule', '* Never overbooked']]);
    expect(tokens('{Cart}')).toEqual([['read-model', '{Cart}']]);
    expect(tokens('== Sales ==')).toEqual([['section', '== Sales ==']]);
  });

  it('reads a chain without an actor as a command and its event', () => {
    expect(tokens('Place order -> (Order) -> OrderPlaced')).toEqual([
      ['command', 'Place order'],
      ['arrow', '->'],
      ['aggregate', '(Order)'],
      ['arrow', '->'],
      ['event', 'OrderPlaced'],
    ]);
  });

  it('marks a bare name as an event', () => {
    expect(tokens('OrderPlaced')).toEqual([['event', 'OrderPlaced']]);
  });

  it('leaves blank and unrecognised lines plain', () => {
    expect(tokens('')).toEqual([]);
    expect(tokens('   ')).toEqual([]);
    expect(tokens('just (words)')).toEqual([]);
  });

  it('copes with incomplete lines while typing', () => {
    expect(tokens('Customer:')).toEqual([
      ['actor', 'Customer'],
      ['punct', ':'],
    ]);
    expect(tokens('  then Ship ->')).toEqual([
      ['keyword', 'then'],
      ['command', 'Ship'],
      ['arrow', '->'],
    ]);
  });
});
