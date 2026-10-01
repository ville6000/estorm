import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '../src/parser.ts';
import type { After, Event, Flow, Hotspot, Reaction, When } from '../src/parser.ts';

const lines = (...ls: string[]) => ls.join('\n');

/** [line, message] of the parse error, or null if TEXT parses. */
function errorOf(text: string): [number, string] | null {
  try {
    parse(text);
    return null;
  } catch (e) {
    if (e instanceof ParseError) return [e.line, e.message];
    throw e;
  }
}

describe('parse', () => {
  it('parses the GRAMMAR.md example', () => {
    expect(
      parse(
        lines(
          '# Ticket handling',
          '{Ticket form with topic list}',
          'Customer: Submit ticket -> (Ticket) -> TicketSubmitted',
          '  then Fetch customer details -> [CRM] -> CustomerDetailsFetched',
          '  {Department topic mapping}',
          '  then Assign by topic -> (Ticket) -> TicketAssigned',
          '  ! Who owns the topic → department mapping?',
        ),
      ),
    ).toEqual([
      {
        type: 'flow',
        line: 3,
        informedBy: [{ type: 'read-model', name: 'Ticket form with topic list', line: 2 }],
        actor: 'Customer',
        command: 'Submit ticket',
        via: [{ type: 'aggregate', name: 'Ticket' }],
        event: 'TicketSubmitted',
        hotspots: [],
        reactions: [
          {
            type: 'reaction',
            line: 4,
            informedBy: [],
            command: 'Fetch customer details',
            via: [{ type: 'external', name: 'CRM' }],
            event: 'CustomerDetailsFetched',
            hotspots: [],
            reactions: [],
          },
          {
            type: 'reaction',
            line: 6,
            informedBy: [{ type: 'read-model', name: 'Department topic mapping', line: 5 }],
            command: 'Assign by topic',
            via: [{ type: 'aggregate', name: 'Ticket' }],
            event: 'TicketAssigned',
            hotspots: [{ type: 'hotspot', text: 'Who owns the topic → department mapping?', line: 7 }],
            reactions: [],
          },
        ],
      },
    ]);
  });

  describe('flows', () => {
    it('parses a minimal flow', () => {
      expect(parse('Customer: Submit ticket -> TicketSubmitted')).toEqual([
        {
          type: 'flow',
          line: 1,
          informedBy: [],
          actor: 'Customer',
          command: 'Submit ticket',
          via: [],
          event: 'TicketSubmitted',
          hotspots: [],
          reactions: [],
        },
      ]);
    });

    it('trims whitespace around arrows and names', () => {
      expect(parse('A  :Do it->[ X ]->  Done  ')[0]).toMatchObject({
        actor: 'A',
        command: 'Do it',
        via: [{ type: 'external', name: 'X' }],
        event: 'Done',
      });
    });

    it('allows a flow without an actor', () => {
      const [flow] = parse(lines('Place order -> (Order) -> OrderPlaced', '  then Ship -> Shipped')) as [Flow];
      expect(flow).toMatchObject({ type: 'flow', command: 'Place order', event: 'OrderPlaced' });
      expect(flow).not.toHaveProperty('actor');
      expect(flow.reactions).toHaveLength(1);
    });

    it('accepts Windows line endings', () => {
      expect(parse('A: Do -> Done\r\n  then B -> BDone\r\n')).toHaveLength(1);
    });
  });

  it('nests reactions by indentation', () => {
    const ast = parse(
      lines('A: Do -> Done', '  then B -> BDone', '    then C -> CDone', '  then D -> DDone', 'E: Go -> Gone'),
    ) as Flow[];
    expect(ast.map((f) => f.event)).toEqual(['Done', 'Gone']);
    const reactions = ast[0]!.reactions as Reaction[];
    expect(reactions.map((r) => r.event)).toEqual(['BDone', 'DDone']);
    expect((reactions[0]!.reactions as Reaction[]).map((r) => r.event)).toEqual(['CDone']);
  });

  it('skips blanks and comments', () => {
    expect(parse(lines('', '# comment', '   ', '  # indented comment'))).toEqual([]);
  });

  describe('hotspots', () => {
    const [board, flow] = parse(
      lines(
        '! board-wide',
        'A: Do -> Done',
        '! caused by Do',
        '  then B -> BDone',
        '! caused by B, despite indent',
        'C: Go -> Gone',
      ),
    ) as [Hotspot, Flow];

    it('puts hotspots before the first flow on the board', () => {
      expect(board).toEqual({ type: 'hotspot', text: 'board-wide', line: 1 });
    });

    it('gives a hotspot to the nearest step above', () => {
      expect(flow.hotspots.map((h) => h.text)).toEqual(['caused by Do']);
      expect((flow.reactions[0] as Reaction).hotspots.map((h) => h.text)).toEqual([
        'caused by B, despite indent',
      ]);
    });
  });

  describe('sections and when', () => {
    const ast = parse(
      lines(
        '== Sales ==',
        'Customer: Place order -> (Order) -> OrderPlaced',
        '== Billing ==',
        '! Who pays shipping?',
        '{Price list}',
        'when OrderPlaced',
        '  then Create invoice -> (Invoice) -> InvoiceCreated',
        '  ! Partial invoices?',
      ),
    );

    it('keeps sections as top-level markers', () => {
      expect(ast.map((i) => i.type)).toEqual(['section', 'flow', 'section', 'hotspot', 'when']);
      expect(ast.flatMap((i) => (i.type === 'section' ? [i.name] : []))).toEqual(['Sales', 'Billing']);
    });

    it('puts a hotspot right after a section header at the top level', () => {
      expect((ast[3] as Hotspot).text).toBe('Who pays shipping?');
    });

    it('gives a when its reactions; read models above it inform them', () => {
      const when = ast[4] as When;
      const r = when.reactions[0] as Reaction;
      expect([when.event, when.line]).toEqual(['OrderPlaced', 6]);
      expect(r.command).toBe('Create invoice');
      expect(r.informedBy.map((rm) => rm.name)).toEqual(['Price list']);
      expect(r.hotspots.map((h) => h.text)).toEqual(['Partial invoices?']);
    });

    it('lets a when refer to an event further down, or from another when', () => {
      expect(
        parse(
          lines('when Done', '  then B -> BDone', 'A: Do -> Done', 'when BDone', '  then C -> CDone'),
        ).map((i) => i.type),
      ).toEqual(['when', 'flow', 'when']);
    });
  });

  describe('events on their own', () => {
    it('reads a bare name as an event', () => {
      expect(parse(lines('OrderPlaced', 'Order shipped'))).toEqual([
        { type: 'event', line: 1, name: 'OrderPlaced', hotspots: [], reactions: [] },
        { type: 'event', line: 2, name: 'Order shipped', hotspots: [], reactions: [] },
      ]);
    });

    it('gives an event its hotspots and reactions', () => {
      const [event] = parse(lines('OrderPlaced', '! Paid yet?', '  then Ship -> Shipped')) as [Event];
      expect(event.hotspots.map((h) => h.text)).toEqual(['Paid yet?']);
      expect((event.reactions[0] as Reaction).event).toBe('Shipped');
    });

    it('lets when and unless refer to it', () => {
      expect(
        parse(
          lines('Paid', 'Placed', 'when Placed', '  after 1 day unless Paid', '    then Cancel -> Cancelled'),
        ).map((i) => i.type),
      ).toEqual(['event', 'event', 'when']);
    });
  });

  describe('time triggers', () => {
    it('delays reactions with after, optionally cancelled by an event', () => {
      const [flow] = parse(
        lines(
          'A: Do -> Done',
          '  after 30 days unless Gone',
          '    {Info}',
          '    then B -> BDone',
          '      ! Why?',
          '  after 1 hour',
          '    then C -> CDone',
          'X: Go -> Gone',
        ),
      ) as Flow[];
      const [after, after2] = flow!.reactions as After[];
      const { reactions, ...rest } = after!;
      expect(rest).toEqual({ type: 'after', line: 2, duration: '30 days', unless: 'Gone' });
      const b = reactions[0] as Reaction;
      expect(b.command).toBe('B');
      expect(b.informedBy.map((rm) => rm.name)).toEqual(['Info']);
      expect(b.hotspots.map((h) => h.text)).toEqual(['Why?']);
      expect(after2!.duration).toBe('1 hour');
      expect(after2).not.toHaveProperty('unless');
    });

    it('allows after under when', () => {
      const [, when] = parse(lines('A: Do -> Done', 'when Done', '  after 2 days', '    then B -> BDone')) as [
        Flow,
        When,
      ];
      expect(when.reactions[0]!.type).toBe('after');
    });

    it('parses every as a flow driven by a schedule; the time may contain colons', () => {
      const [flow] = parse('every night at 02:00: Archive -> Archived') as Flow[];
      expect(flow).toMatchObject({ type: 'flow', schedule: 'night at 02:00', command: 'Archive', event: 'Archived' });
      expect(flow).not.toHaveProperty('actor');
    });
  });

  it.each<[number, string, string]>([
    [1, "'then' has no parent flow", 'then Do -> Done'],
    [2, "'then' must be one level deeper than its parent", lines('A: Do -> Done', '    then B -> C')],
    [1, 'flow must not be indented', '  A: Do -> Done'],
    [1, 'tab in indentation', '\tA: Do -> Done'],
    [1, 'indentation must be a multiple of 2 spaces', ' A: Do -> Done'],
    [1, 'chain must end with an event', 'A: Do'],
    [1, 'chain must end with an event, got [CRM]', 'A: Do -> [CRM]'],
    [1, 'expected (Aggregate) or [External], got Middle', 'A: Do -> Middle -> Done'],
    [1, 'expected a command, got (Agg)', 'A: (Agg) -> Done'],
    [1, 'empty item in chain', 'A: Do -> -> Done'],
    [1, 'invalid item: {X}', 'A: Do -> {X} -> Done'],
    [1, 'invalid actor: [Sys]', '[Sys]: Do -> Done'],
    [1, 'empty hotspot', '!'],
    [1, 'unrecognised line', 'just (some) prose'],
    [1, 'expected a command, got (Order)', '(Order) -> Done'],
    [2, 'flow must not be indented', lines('A: Do -> Done', '  B -> BDone')],
    [2, 'event must not be indented', lines('A: Do -> Done', '  Done twice')],
    [1, 'read model {X} informs nothing', lines('{X}', 'Done')],
    [1, 'read model {X} informs nothing', '{X}'],
    [2, 'read model {X} informs nothing', lines('A: Do -> Done', '  {X}', 'B: Go -> Gone')],
    [2, 'read model {X} informs nothing', lines('A: Do -> Done', '{X}', '== S ==')],
    [1, 'empty section name', '== =='],
    [1, 'section must not be indented', '  == S =='],
    [2, "'when' must not be indented", lines('A: Do -> Done', '  when Done')],
    [1, "'when' expects an event name, got (Done)", 'when (Done)'],
    [2, "'when' has no reactions", lines('A: Do -> Done', 'when Done')],
    [1, "'when' refers to unknown event Nope", lines('when Nope', '  then B -> BDone')],
    [1, "'after' has no parent flow", lines('after 1 day', '  then B -> BDone')],
    [2, "'after' has no reactions", lines('A: Do -> Done', '  after 1 day')],
    [2, "'unless' refers to unknown event Nope", lines('A: Do -> Done', '  after 1 day unless Nope', '    then B -> BDone')],
    [2, "'unless' expects an event name, got (Nope)", lines('A: Do -> Done', '  after 1 day unless (Nope)')],
    [3, "hotspot must follow a flow or reaction, not 'after'", lines('A: Do -> Done', '  after 1 day', '  ! Why?', '    then B -> BDone')],
    [1, 'chain must end with an event', 'every day: Archive'],
    [3, "hotspot must follow a flow or reaction, not 'when'", lines('A: Do -> Done', 'when Done', '! Why?', '  then B -> BDone')],
  ])('reports line %i: %s', (line, message, text) => {
    expect(errorOf(text)).toEqual([line, message]);
  });

  it.each(readdirSync('examples').filter((f) => f.endsWith('.estorm')))('parses examples/%s', (f) => {
    expect(parse(readFileSync(`examples/${f}`, 'utf8')).length).toBeGreaterThan(0);
  });
});
