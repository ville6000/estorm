import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.ts';
import { COL_GAP, timeline } from '../src/timeline.ts';
import { STICKY_W } from '../src/layout.ts';
import type { Sticky } from '../src/layout.ts';

const board = (...lines: string[]) => timeline(parse(lines.join('\n')));

const at = (stickies: Sticky[], text: string) => stickies.find((s) => s.text === text)!;

/** Column of the event named TEXT. */
const col = (stickies: Sticky[], text: string) => (at(stickies, text).x - stickies[0]!.x) / (STICKY_W + COL_GAP);

describe('timeline', () => {
  it('shows only events', () => {
    const { stickies } = board('{Cart}', 'Customer: Place order -> (Order) -> [Stripe] -> OrderPlaced');
    expect(stickies.map((s) => [s.kind, s.text])).toEqual([['event', 'OrderPlaced']]);
  });

  it('puts a reaction after its event, with an arrow', () => {
    const { stickies, arrows, links } = board('A: Do -> Done', '  then B -> BDone', '    then C -> CDone');
    expect(['Done', 'BDone', 'CDone'].map((e) => col(stickies, e))).toEqual([0, 1, 2]);
    expect(new Set(stickies.map((s) => s.y)).size).toBe(1);
    expect(arrows).toHaveLength(2);
    expect(links).toHaveLength(0);
  });

  it('puts delayed reactions after their event', () => {
    const { stickies } = board('A: Do -> Done', '  after 1 day', '    then B -> BDone');
    expect(col(stickies, 'BDone')).toBe(1);
  });

  it('lines up events across sections, as swimlanes', () => {
    const { stickies, lanes, panels, links } = board(
      '== Sales ==',
      'C: Place order -> OrderPlaced',
      '== Payments ==',
      'when OrderPlaced',
      '  then Charge -> PaymentCaptured',
      '== Warehouse ==',
      'when PaymentCaptured',
      '  then Ship -> Shipped',
    );
    expect(['OrderPlaced', 'PaymentCaptured', 'Shipped'].map((e) => col(stickies, e))).toEqual([0, 1, 2]);
    expect(lanes.map((l) => l.name)).toEqual(['Sales', 'Payments', 'Warehouse']);
    expect(new Set(lanes.map((l) => l.x))).toEqual(new Set([0]));
    expect(lanes[0]!.y + lanes[0]!.h).toBeLessThanOrEqual(lanes[1]!.y);
    expect(at(stickies, 'PaymentCaptured').y).toBeGreaterThan(lanes[1]!.y);
    expect(panels.map(({ y, h }) => [y, h])).toEqual(lanes.map(({ y, h }) => [y, h]));
    expect(links).toHaveLength(2);
  });

  it('puts a when above its event in the source after that event in time', () => {
    const { stickies } = board(
      '== Payments ==',
      'when OrderPlaced',
      '  then Charge -> PaymentCaptured',
      '== Sales ==',
      'C: Place order -> OrderPlaced',
    );
    expect(col(stickies, 'PaymentCaptured')).toBe(col(stickies, 'OrderPlaced') + 1);
  });

  it('puts a when on several events after the latest, linked from each', () => {
    const { stickies, links } = board(
      '== Sales ==',
      'A: Do -> Early',
      '  then B -> Late',
      '== Billing ==',
      'when Late, Early',
      '  then C -> Charged',
    );
    expect(col(stickies, 'Charged')).toBe(col(stickies, 'Late') + 1);
    expect(links).toHaveLength(2);
  });

  it('puts a run of events in consecutive columns, without arrows', () => {
    const { stickies, arrows, links } = board('A', 'B', 'C');
    expect(['A', 'B', 'C'].map((e) => col(stickies, e))).toEqual([0, 1, 2]);
    expect(arrows).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it('draws an event produced twice once', () => {
    const { stickies } = board('A: Do -> Done', 'B: Again -> Done');
    expect(stickies.filter((s) => s.text === 'Done')).toHaveLength(1);
  });

  it('stacks events of a section that share a column, in source order', () => {
    const { stickies } = board('A: Do -> First', 'B: Do -> Second');
    const [first, second] = [at(stickies, 'First'), at(stickies, 'Second')];
    expect(first.x).toBe(second.x);
    expect(first.y).toBeLessThan(second.y);
  });

  it('never puts a flow left of the one above it in its section', () => {
    const { stickies } = board(
      '== S ==',
      'A: Do -> Done',
      '  then B -> BDone',
      '== T ==',
      'when BDone',
      '  then C -> CDone',
      'D: Other -> Unrelated',
    );
    expect(col(stickies, 'Unrelated')).toBe(col(stickies, 'CDone'));
  });

  it('ends on a cycle', () => {
    const { stickies } = board('A: Do -> X', 'when X', '  then B -> Y', 'when Y', '  then C -> X');
    expect(['X', 'Y'].map((e) => col(stickies, e))).toEqual([0, 1]);
  });

  it('labels no lanes on a board without sections', () => {
    const { lanes, panels } = board('A: Do -> Done');
    expect(lanes).toEqual([]);
    expect(panels).toHaveLength(1);
  });

  it('is empty for an empty board', () => {
    const { stickies, width } = board('');
    expect(stickies).toEqual([]);
    expect(width).toBe(0);
  });
});
