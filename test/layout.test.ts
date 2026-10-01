import { describe, expect, it } from 'vitest';
import { LANE_GAP, LANE_PAD, layout } from '../src/layout.ts';
import type { Sticky } from '../src/layout.ts';
import { parse } from '../src/parser.ts';

const board = (...lines: string[]) => layout(parse(lines.join('\n')));

const find = (stickies: Sticky[], text: string, kind?: Sticky['kind']) =>
  stickies.find((s) => s.text === text && (kind === undefined || s.kind === kind))!;

const right = (s: Sticky) => s.x + s.w;

describe('layout', () => {
  it('puts a flow on one row, left to right', () => {
    const { stickies, arrows } = board('{Cart}', 'Customer: Place order -> (Order) -> [Stripe] -> OrderPlaced');
    expect(stickies.map((s) => s.kind)).toEqual(['read-model', 'actor', 'command', 'aggregate', 'external', 'event']);
    expect(new Set(stickies.map((s) => s.y)).size).toBe(1);
    expect(stickies.map((s) => s.x)).toEqual([...stickies.map((s) => s.x)].sort((a, b) => a - b));
    expect(arrows).toHaveLength(3); // read model, actor and command have no arrows between them
  });

  it('makes read model, actor and command touch; the rest have gaps', () => {
    const [rm, actor, command, agg] = board('{Cart}', 'Customer: Place order -> (Order) -> OrderPlaced').stickies;
    expect(right(rm!)).toBe(actor!.x);
    expect(right(actor!)).toBe(command!.x);
    expect(right(command!)).toBeLessThan(agg!.x);
  });

  it('starts a flow without an actor at its command', () => {
    const { stickies, arrows } = board('{Cart}', 'Place order -> OrderPlaced');
    expect(stickies.map((s) => s.kind)).toEqual(['read-model', 'command', 'event']);
    expect(right(stickies[0]!)).toBe(stickies[1]!.x);
    expect(arrows).toHaveLength(1);
  });

  it('makes read model, policy and command touch', () => {
    const { stickies } = board('A: Do -> Done', '  {Info}', '  then B -> BDone');
    const [rm, policy, command] = stickies.slice(3);
    expect([rm, policy, command].map((s) => s!.kind)).toEqual(['read-model', 'policy', 'command']);
    expect(right(rm!)).toBe(policy!.x);
    expect(right(policy!)).toBe(command!.x);
  });

  it('starts reactions under their event, each on its own row', () => {
    const { stickies } = board('A: Do -> Done', '  then B -> BDone', '  then C -> CDone');
    const event = find(stickies, 'Done');
    const policies = stickies.filter((s) => s.kind === 'policy');
    expect(policies.map((p) => p.text)).toEqual(['whenever Done', 'whenever Done']);
    expect(policies.every((p) => p.x === event.x)).toBe(true);
    expect(event.y).toBeLessThan(policies[0]!.y);
    expect(policies[0]!.y).toBeLessThan(policies[1]!.y);
  });

  describe('hotspots', () => {
    it('puts board hotspots on a row of their own above the flows', () => {
      const [hotspot, actor] = board('! Why?', 'A: Do -> Done').stickies;
      expect(hotspot!.kind).toBe('hotspot');
      expect(hotspot!.y).toBeLessThan(actor!.y);
    });

    it('puts step hotspots right of the event that caused them', () => {
      const [event, hotspot] = board('A: Do -> Done', '! Why?').stickies.slice(-2);
      expect([event!.kind, hotspot!.kind]).toEqual(['event', 'hotspot']);
      expect(hotspot!.y).toBe(event!.y);
      expect(hotspot!.x).toBeGreaterThan(event!.x);
    });
  });

  describe('events on their own', () => {
    it('puts consecutive events on one row, without arrows', () => {
      const { stickies, arrows } = board('Placed', 'Paid', 'Shipped');
      expect(stickies.map((s) => s.kind)).toEqual(['event', 'event', 'event']);
      expect(new Set(stickies.map((s) => s.y)).size).toBe(1);
      expect(right(stickies[0]!)).toBeLessThan(stickies[1]!.x);
      expect(right(stickies[1]!)).toBeLessThan(stickies[2]!.x);
      expect(arrows).toEqual([]);
    });

    it('puts hotspots right after their event in the row', () => {
      const [placed, hotspot, paid] = board('Placed', '! Why?', 'Paid').stickies;
      expect([placed!.kind, hotspot!.kind, paid!.kind]).toEqual(['event', 'hotspot', 'event']);
      expect(hotspot!.y).toBe(placed!.y);
      expect(paid!.x).toBeGreaterThan(hotspot!.x);
    });

    it('starts a new row after a flow, or after an event with reactions', () => {
      const { stickies } = board('Placed', 'A: Do -> Done', 'Paid', '  then Ship -> Shipped', 'Packed');
      const ys = ['Placed', 'Done', 'Paid', 'whenever Paid', 'Packed'].map((t) => find(stickies, t).y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
      expect(new Set(ys).size).toBe(5);
      expect(find(stickies, 'whenever Paid').x).toBe(find(stickies, 'Paid').x);
    });
  });

  it('fits the board around stickies', () => {
    const { width, height, stickies } = board('A: Do -> Done', '  then B -> BDone');
    expect(stickies.every((s) => s.x + s.w <= width && s.y + s.h <= height)).toBe(true);
  });

  it('lays out an empty board', () => {
    expect(layout([])).toMatchObject({ width: 0, stickies: [], lanes: [] });
  });

  describe('lanes', () => {
    const { lanes, gaps, stickies, width, height } = board(
      'A: Do -> Done',
      '== Sales ==',
      'B: Go -> Gone',
      '== Billing ==',
      'C: Run -> Ran',
      '== Sales ==',
      'D: Walk -> Walked',
    );
    const inside = (lane: { x: number; w: number }, s: Sticky) => lane.x <= s.x && right(s) <= lane.x + lane.w;

    it('reuses the lane of a reopened section', () => {
      expect(lanes.map((l) => l.name)).toEqual(['Sales', 'Billing']);
    });

    it('puts content before the first section in an unnamed lane on the left', () => {
      expect(find(stickies, 'Done').x).toBeLessThan(lanes[0]!.x);
    });

    it('places lanes left to right, full height, with gaps between', () => {
      expect(lanes[0]!.x).toBeLessThan(lanes[1]!.x);
      expect(lanes.every((l) => l.y === 0 && l.h === height)).toBe(true);
      expect(width).toBe(lanes[1]!.x + lanes[1]!.w);
      expect(lanes[1]!.x - (lanes[0]!.x + lanes[0]!.w)).toBe(LANE_GAP);
      expect(gaps.slice(1)).toEqual([{ x: lanes[0]!.x + lanes[0]!.w, y: 0, w: LANE_GAP, h: height }]);
    });

    it('keeps each section inside its lane, starting at the top', () => {
      expect(inside(lanes[0]!, find(stickies, 'Gone'))).toBe(true);
      expect(inside(lanes[0]!, find(stickies, 'Walked'))).toBe(true);
      expect(inside(lanes[1]!, find(stickies, 'Ran'))).toBe(true);
      expect(find(stickies, 'Gone').y).toBe(find(stickies, 'Ran').y);
    });
  });

  it('starts a when in another lane at its left edge, level with the event', () => {
    const { stickies, lanes, links } = board(
      '== Sales ==',
      'A: Do -> Done',
      'B: Go -> Gone',
      '== Billing ==',
      'C: Run -> Ran',
      'when Gone',
      '  then D -> DDone',
    );
    const policy = find(stickies, 'whenever Gone');
    expect(policy.x).toBe(lanes[1]!.x + LANE_PAD);
    expect(policy.y).toBe(find(stickies, 'Gone', 'event').y);
    expect(links).toHaveLength(1);
  });

  describe('when links', () => {
    const { stickies, arrows, links } = board(
      'when Done',
      '  then B -> BDone',
      'A: Do -> (Agg) -> Done',
      'when BDone',
      '  then C -> CDone',
    );
    const p1 = find(stickies, 'whenever Done');

    it('starts the policy under the named event, even one placed later', () => {
      expect(p1.x).toBe(find(stickies, 'Done', 'event').x);
      expect(find(stickies, 'whenever BDone').x).toBe(find(stickies, 'BDone', 'event').x);
    });

    it('draws links apart from arrows', () => {
      expect(links).toHaveLength(2);
      expect(arrows).toHaveLength(4);
    });

    it('ends a link on top of its policy', () => {
      const [x, y] = links[0]!.at(-1)!;
      expect(y).toBe(p1.y);
      expect(x).toBeGreaterThan(p1.x);
      expect(x).toBeLessThan(right(p1));
    });
  });

  it('keeps a link that dips below the last row on the board', () => {
    const { height, links } = board('== A ==', 'X: Do -> Done', '== B ==', 'when Done', '  then B -> BDone');
    expect(links.flat().every(([, y]) => y < height)).toBe(true);
  });

  it('keeps link rails inside the board', () => {
    const { width, links } = board('== A ==', 'when Done', '  then B -> BDone', '== B ==', 'X: Do -> Done');
    expect(links.flat().every(([x]) => x >= 0 && x <= width)).toBe(true);
  });

  describe('time triggers', () => {
    const { stickies, cancels, arrows } = board(
      'A: Do -> Done',
      '  after 30 days unless Gone',
      '    then B -> BDone',
      'every night at 02:00: Go -> Gone',
    );
    const policy = stickies.find((s) => s.kind === 'policy')!;
    const schedule = stickies.find((s) => s.kind === 'schedule')!;

    it('places a delayed policy under its event', () => {
      expect(policy.text).toBe('⏰ 30 days after Done, unless Gone');
      expect(policy.x).toBe(find(stickies, 'Done').x);
    });

    it('links the unless event into the policy', () => {
      expect(cancels).toHaveLength(1);
      expect(cancels[0]!.at(-1)![1]).toBe(policy.y);
      expect(arrows).toHaveLength(4);
    });

    it('puts a schedule in the place of the actor, touching its command', () => {
      expect(schedule.text).toBe('⏰ every night at 02:00');
      expect(right(schedule)).toBe(find(stickies, 'Go').x);
    });
  });
});
