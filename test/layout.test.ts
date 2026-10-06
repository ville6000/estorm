import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANE_PAD, layout, SWIMLANE_GAP } from '../src/layout.ts';
import type { Point, Sticky } from '../src/layout.ts';
import { parse, parseAll } from '../src/parser.ts';

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

  describe('rules', () => {
    const many = [
      '  * Rooms are never double-booked for a night',
      '  * A stay lasts at least one night',
      '  * Only guests over 18 may book',
    ];
    const { stickies, arrows } = board('A: Book -> (Booking) -> Booked', ...many, '  then Pay -> Paid');

    it('lists rules in the aggregate, which grows to fit them', () => {
      const agg = find(stickies, 'Booking', 'aggregate');
      expect(agg.rules).toEqual([
        'Rooms are never double-booked for a night',
        'A stay lasts at least one night',
        'Only guests over 18 may book',
      ]);
      expect(agg.h).toBeGreaterThan(find(stickies, 'Booked').h);
    });

    it('pushes the next row below the tall aggregate', () => {
      const agg = find(stickies, 'Booking', 'aggregate');
      expect(find(stickies, 'whenever Booked').y).toBeGreaterThan(agg.y + agg.h);
    });

    it('routes reaction arrows below the tall aggregate', () => {
      const agg = find(stickies, 'Booking', 'aggregate');
      const branch = arrows.find((a) => a.length > 2)!;
      expect(branch[1]![1]).toBeGreaterThan(agg.y + agg.h);
    });

    it('keeps aggregates without rules plain', () => {
      expect(find(board('A: Do -> (X) -> Done').stickies, 'X')).not.toHaveProperty('rules');
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
    const { lanes, panels, stickies, width, height } = board(
      'A: Do -> Done',
      '== Sales ==',
      'B: Go -> Gone',
      '== Billing ==',
      'C: Run -> Ran',
      '== Sales ==',
      'D: Walk -> Walked',
    );
    const inside = (lane: { y: number; h: number }, s: Sticky) => lane.y <= s.y && s.y + s.h <= lane.y + lane.h;

    it('reuses the lane of a reopened section', () => {
      expect(lanes.map((l) => l.name)).toEqual(['Sales', 'Billing']);
    });

    it('puts content before the first section in an unnamed lane on top', () => {
      expect(find(stickies, 'Done').y).toBeLessThan(lanes[0]!.y);
    });

    it('stacks lanes top to bottom, full width, each on a panel with space between', () => {
      expect(lanes[0]!.y + lanes[0]!.h + SWIMLANE_GAP).toBe(lanes[1]!.y);
      expect(lanes.every((l) => l.x === 0 && l.w === width)).toBe(true);
      expect(height).toBe(lanes[1]!.y + lanes[1]!.h);
      expect(panels.slice(1)).toEqual(lanes.map(({ y, h }) => ({ x: 0, y, w: width, h })));
    });

    it('keeps each section inside its lane, starting at the left', () => {
      expect(inside(lanes[0]!, find(stickies, 'Gone'))).toBe(true);
      expect(inside(lanes[0]!, find(stickies, 'Walked'))).toBe(true);
      expect(inside(lanes[1]!, find(stickies, 'Ran'))).toBe(true);
      expect(find(stickies, 'B', 'actor').x).toBe(LANE_PAD);
      expect(find(stickies, 'C', 'actor').x).toBe(LANE_PAD);
    });
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

describe('across lanes', () => {
  const lanes = (...lines: string[]) => layout(parse(lines.join('\n')));

  /** Whether segment A-B of an axis-aligned path runs through the inside of S. */
  const through = ([ax, ay]: Point, [bx, by]: Point, s: Sticky) =>
    Math.max(ax, bx) > s.x + 1 &&
    Math.min(ax, bx) < s.x + s.w - 1 &&
    Math.max(ay, by) > s.y + 1 &&
    Math.min(ay, by) < s.y + s.h - 1;

  const overlap = (a: Sticky, b: Sticky) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("starts a 'when' in another lane right of its event, on the lane's next free row", () => {
    const { stickies } = lanes(
      '== Sales ==',
      'A: Do -> Done',
      '== Billing ==',
      'B: Bill -> Billed',
      'when Done',
      '  then Charge -> Charged',
    );
    const policy = find(stickies, 'whenever Done');
    expect(policy.x).toBeGreaterThan(right(find(stickies, 'Done')));
    expect(policy.y).toBeGreaterThan(find(stickies, 'Billed').y);
  });

  it('places a when whose event comes later in the file', () => {
    const { stickies } = lanes(
      '== Billing ==',
      'when Done',
      '  then Charge -> Charged',
      '== Sales ==',
      'A: Do -> Done',
    );
    expect(find(stickies, 'whenever Done').x).toBeGreaterThan(right(find(stickies, 'Done')));
  });

  it('never starts a flow left of the one above it in its lane', () => {
    const { stickies } = lanes(
      '== Sales ==',
      'A: Do -> Done',
      '== Billing ==',
      'when Done',
      '  then Charge -> Charged',
      'B: Bill -> Billed',
    );
    expect(find(stickies, 'B').x).toBe(find(stickies, 'whenever Done').x);
  });

  describe('a when on several events', () => {
    const { stickies, links } = lanes(
      '== Sales ==',
      'A: Do -> Done',
      'B: Go -> Gone',
      '== Billing ==',
      'C: Bill -> Billed',
      'when Done, Billed, Gone',
      '  after 2 days',
      '    then Charge -> Charged',
    );
    const policy = find(stickies, '⏰ 2 days after Done, Billed or Gone');

    it('draws one policy, linked from each event', () => {
      expect(stickies.filter((s) => s.kind === 'policy')).toEqual([policy]);
      expect(links).toHaveLength(3);
      expect(links.every((l) => l.at(-1)![1] === policy.y)).toBe(true);
    });

    it('starts right of the latest event', () => {
      expect(policy.x).toBe(find(stickies, 'Gone').x + find(stickies, 'Gone').w + 30);
    });
  });

  it('labels a policy on two events with or', () => {
    const { stickies } = lanes('A', 'B', 'when A, B', '  then C -> D');
    expect(stickies.filter((s) => s.kind === 'policy').map((s) => s.text)).toEqual(['whenever A or B']);
  });

  it('keeps reactions in a lane under their event', () => {
    const { stickies } = lanes('A: Do -> Done', '  then B -> BDone');
    expect(find(stickies, 'whenever Done').x).toBe(find(stickies, 'Done').x);
  });

  it('lays out a board with errors, leaving out links to events on broken lines', () => {
    const { board, errors } = parseAll(
      [
        'X: Do -> OrderPlaced -> Paid (',
        'when OrderPlaced',
        '  then A -> B',
        '  after 5 minutes unless Paid',
        '    then C -> D',
      ].join('\n'),
    );
    expect(errors.map((e) => e.line)).toEqual([1]);
    const l = layout(board);
    expect(l.links).toEqual([]);
    expect(l.cancels).toEqual([]);
    expect(find(l.stickies, 'B')).toBeDefined();
  });

  it.each(readdirSync('examples').filter((f) => f.endsWith('.estorm')))(
    '%s has no overlapping stickies and no links through stickies',
    (f) => {
      const l = layout(parse(readFileSync(`examples/${f}`, 'utf8')));
      const pairs = l.stickies.flatMap((a, i) => l.stickies.slice(i + 1).filter((b) => overlap(a, b)));
      expect(pairs).toEqual([]);
      for (const path of [...l.links, ...l.cancels]) {
        for (let i = 1; i < path.length; i++) {
          expect(l.stickies.filter((s) => through(path[i - 1]!, path[i]!, s))).toEqual([]);
        }
      }
    },
  );
});
