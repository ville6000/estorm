/**
 * Summarises a board as Markdown: what is hard to see on the board itself,
 * such as how bounded contexts depend on each other, what each actor does,
 * which commands each aggregate handles and the rules it enforces, events nothing reacts to, and all
 * hotspots in one list.
 */
import type { Board, Hotspot, Rule, Step, Via } from './parser.ts';

/** Keys in insertion order, each with its distinct values in insertion order. */
class Groups extends Map<string, Set<string>> {
  add(key: string, value: string): void {
    if (!this.has(key)) this.set(key, new Set());
    this.get(key)!.add(value);
  }

  lines(): string[] {
    return [...this].map(([key, values]) => `- ${key}: ${[...values].join(', ')}`);
  }
}

interface Facts {
  /** Each event, with the section of the first step producing it. */
  produced: Map<string, string | undefined>;
  /** Events something reacts to (a policy, 'when' or 'unless'), with the section reacting. */
  reactions: { event: string; section: string | undefined }[];
  actors: Groups;
  aggregates: Groups;
  rules: Groups;
  externals: Groups;
  hotspots: string[];
}

function collect(board: Board): Facts {
  const facts: Facts = {
    produced: new Map(),
    reactions: [],
    actors: new Groups(),
    aggregates: new Groups(),
    rules: new Groups(),
    externals: new Groups(),
    hotspots: [],
  };
  let section: string | undefined;

  const produce = (event: string) => {
    if (!facts.produced.has(event)) facts.produced.set(event, section);
  };
  const react = (event: string) => facts.reactions.push({ event, section });
  const hotspots = (list: Hotspot[], on: string) => {
    const where = section === undefined ? on : `${section}, ${on}`;
    for (const h of list) facts.hotspots.push(`- ${h.text} (${where})`);
  };
  const command = (name: string, via: Via[], rules: Rule[]) => {
    for (const v of via) (v.type === 'aggregate' ? facts.aggregates : facts.externals).add(v.name, name);
    const aggregate = via.find((v) => v.type === 'aggregate');
    for (const r of rules) facts.rules.add(aggregate!.name, r.text);
  };
  const steps = (event: string, list: Step[]) => {
    for (const s of list) {
      react(event);
      if (s.type === 'after') {
        if (s.unless !== undefined) react(s.unless);
        steps(event, s.reactions);
        continue;
      }
      produce(s.event);
      command(s.command, s.via, s.rules);
      hotspots(s.hotspots, s.command);
      steps(s.event, s.reactions);
    }
  };

  for (const item of board) {
    switch (item.type) {
      case 'section':
        section = item.name;
        break;
      case 'hotspot':
        facts.hotspots.push(`- ${item.text}${section === undefined ? '' : ` (${section})`}`);
        break;
      case 'event':
        produce(item.name);
        hotspots(item.hotspots, item.name);
        steps(item.name, item.reactions);
        break;
      case 'when':
        steps(item.event, item.reactions);
        break;
      case 'flow':
        produce(item.event);
        command(item.command, item.via, item.rules);
        facts.actors.add(
          item.actor ?? (item.schedule !== undefined ? `Every ${item.schedule}` : 'Unknown actor'),
          item.command,
        );
        hotspots(item.hotspots, item.command);
        steps(item.event, item.reactions);
        break;
    }
  }
  return facts;
}

/** "Sales → Payments: OrderPlaced", for each event reacted to in another section. */
function dependencies({ produced, reactions }: Facts): Groups {
  const deps = new Groups();
  for (const { event, section } of reactions) {
    const from = produced.get(event);
    if (from !== undefined && section !== undefined && from !== section) deps.add(`${from} → ${section}`, event);
  }
  return deps;
}

function part(heading: string, lines: string[], note?: string): string[] {
  return lines.length ? [`## ${heading}`, '', ...(note ? [note, ''] : []), ...lines] : [];
}

/** Summarises a parsed board as Markdown. */
export function summarize(board: Board): string {
  const facts = collect(board);
  const reacted = new Set(facts.reactions.map((r) => r.event));
  const unreacted = [...facts.produced.keys()].filter((e) => !reacted.has(e));
  const parts = [
    part(
      'Context dependencies',
      dependencies(facts).lines(),
      'Each line: events of the first context that the second reacts to.',
    ),
    part('Actors', facts.actors.lines(), 'Commands each actor or schedule issues.'),
    part('Aggregates', facts.aggregates.lines(), 'Commands each aggregate handles.'),
    part('Rules', facts.rules.lines(), 'Business rules each aggregate enforces.'),
    part('External systems', facts.externals.lines(), 'Commands that go through each external system.'),
    part(
      'Events nothing reacts to',
      unreacted.map((e) => `- ${e}`),
      'Usually the end of a flow; check none of them is a missing step.',
    ),
    part(`Hotspots (${facts.hotspots.length})`, facts.hotspots),
  ].filter((p) => p.length);
  return parts.map((p) => p.join('\n')).join('\n\n') + '\n';
}
