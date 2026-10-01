/**
 * Parses estorm notation (see GRAMMAR.md) into an AST.
 * Errors are thrown as ParseError, with the 1-based line number.
 */

export interface ReadModel {
  type: 'read-model';
  name: string;
  line: number;
}

export interface Hotspot {
  type: 'hotspot';
  text: string;
  line: number;
}

export interface Via {
  type: 'aggregate' | 'external';
  name: string;
}

interface Chain {
  command: string;
  via: Via[];
  event: string;
}

/** An actor (or a schedule) issues a command, producing an event. */
export interface Flow extends Chain {
  type: 'flow';
  line: number;
  informedBy: ReadModel[];
  /** Who issues the command. Absent for a schedule. */
  actor?: string;
  /** When the command runs, e.g. "night at 02:00". Absent for an actor. */
  schedule?: string;
  hotspots: Hotspot[];
  reactions: Step[];
}

/** A policy reacts to the event of its parent, issuing a command. */
export interface Reaction extends Chain {
  type: 'reaction';
  line: number;
  informedBy: ReadModel[];
  hotspots: Hotspot[];
  reactions: Step[];
}

/** Delays the reactions it holds; an `unless` event cancels them. */
export interface After {
  type: 'after';
  line: number;
  duration: string;
  unless?: string;
  reactions: Step[];
}

/** Reacts to an event by name, usually one from another section. */
export interface When {
  type: 'when';
  line: number;
  event: string;
  reactions: Step[];
}

/**
 * An event on its own, before its cause is known. Consecutive ones form a
 * timeline; policies may react to it like to the event of a flow.
 */
export interface Event {
  type: 'event';
  line: number;
  name: string;
  hotspots: Hotspot[];
  reactions: Step[];
}

/** Starts a bounded context; items below belong to it. */
export interface Section {
  type: 'section';
  name: string;
  line: number;
}

export type Step = Reaction | After;
export type TopLevel = Flow | Event | When | Section | Hotspot;
export type Board = TopLevel[];

export class ParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
  }
}

function fail(line: number, message: string): never {
  throw new ParseError(line, message);
}

const NAME = /^[^()[\]{}:]+$/;

type Item = Via | { type: 'name'; name: string };

/** One chain item: (Aggregate), [External] or a bare name. null if invalid. */
function parseItem(s: string): Item | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^\((.+)\)$/))) return { type: 'aggregate', name: m[1]!.trim() };
  if ((m = s.match(/^\[(.+)\]$/))) return { type: 'external', name: m[1]!.trim() };
  if (NAME.test(s)) return { type: 'name', name: s };
  return null;
}

/** `Command -> ... -> Event` into {command, via, event}. */
function parseChain(line: number, s: string): Chain {
  const raw = s.split('->').map((x) => x.trim());
  if (raw.some((x) => x === '')) fail(line, 'empty item in chain');
  const items = raw.map((x) => parseItem(x) ?? fail(line, `invalid item: ${x}`));
  const [command, ...more] = items;
  const event = more.at(-1);
  const via = more.slice(0, -1);
  if (command!.type !== 'name') fail(line, `expected a command, got ${raw[0]}`);
  if (!event) fail(line, 'chain must end with an event');
  if (event.type !== 'name') fail(line, `chain must end with an event, got ${raw.at(-1)}`);
  const bad = via.find((v) => v.type === 'name');
  if (bad) fail(line, `expected (Aggregate) or [External], got ${bad.name}`);
  return { command: command!.name, via: via as Via[], event: event.name };
}

/** A source line, classified, with its indentation level. */
type Stmt = { line: number; level: number } & (
  | { type: 'hotspot'; text: string }
  | { type: 'section'; name: string }
  | { type: 'read-model'; name: string }
  | { type: 'when'; event: string }
  | { type: 'after'; duration: string; unless?: string }
  | ({ type: 'flow'; actor?: string; schedule?: string } & Chain)
  | ({ type: 'reaction' } & Chain)
  | { type: 'event'; name: string }
);

function checkEventName(line: number, keyword: string, event: string): void {
  if (!NAME.test(event) || event.includes('->')) {
    fail(line, `'${keyword}' expects an event name, got ${event}`);
  }
}

/** One source line into a statement, or null for blanks and comments. */
function classify(n: number, raw: string): Stmt | null {
  const indent = raw.match(/^[ \t]*/)![0];
  const text = raw.trim();
  if (text === '' || text.startsWith('#')) return null;
  if (indent.includes('\t')) fail(n, 'tab in indentation');
  if (indent.length % 2 === 1) fail(n, 'indentation must be a multiple of 2 spaces');

  const base = { line: n, level: indent.length / 2 };
  let m: RegExpMatchArray | null;

  if (text.startsWith('!')) {
    const t = text.slice(1).trim();
    if (t === '') fail(n, 'empty hotspot');
    return { ...base, type: 'hotspot', text: t };
  }
  if ((m = text.match(/^==\s*(.*?)\s*==$/))) {
    if (m[1] === '') fail(n, 'empty section name');
    if (base.level > 0) fail(n, 'section must not be indented');
    return { ...base, type: 'section', name: m[1]! };
  }
  if ((m = text.match(/^\{([^{}]+)\}$/))) {
    return { ...base, type: 'read-model', name: m[1]!.trim() };
  }
  if ((m = text.match(/^when\s+(.+)$/))) {
    const event = m[1]!.trim();
    checkEventName(n, 'when', event);
    return { ...base, type: 'when', event };
  }
  if ((m = text.match(/^after\s+(.+?)(?:\s+unless\s+(.+))?$/))) {
    const unless = m[2]?.trim();
    if (unless !== undefined) checkEventName(n, 'unless', unless);
    return {
      ...base,
      type: 'after',
      duration: m[1]!.trim(),
      ...(unless !== undefined && { unless }),
    };
  }
  if ((m = text.match(/^every\s+(.+?):\s+(.*)$/))) {
    return { ...base, type: 'flow', schedule: m[1]!.trim(), ...parseChain(n, m[2]!) };
  }
  if ((m = text.match(/^then\s+(.+)$/))) {
    return { ...base, type: 'reaction', ...parseChain(n, m[1]!) };
  }
  if ((m = text.match(/^([^:]+):(.*)$/))) {
    const actor = m[1]!.trim();
    if (!NAME.test(actor)) fail(n, `invalid actor: ${actor}`);
    return { ...base, type: 'flow', actor, ...parseChain(n, m[2]!) };
  }
  if (NAME.test(text) && !text.includes('->')) {
    return { ...base, type: 'event', name: text };
  }
  return fail(n, 'unrecognised line');
}

/** A step while collecting: a flow, when, after or reaction, flat. */
type Flat = (Flow | Event | When | After | Reaction) & { level: number };

function checkLevel(steps: Flat[], { type, level, line }: Stmt): void {
  const prev = steps.at(-1)?.level;
  switch (type) {
    case 'flow':
      if (level > 0) fail(line, 'flow must not be indented');
      break;
    case 'when':
      if (level > 0) fail(line, "'when' must not be indented");
      break;
    case 'event':
      if (level > 0) fail(line, 'event must not be indented');
      break;
    case 'reaction':
    case 'after': {
      const keyword = type === 'after' ? 'after' : 'then';
      if (level === 0 || prev === undefined) fail(line, `'${keyword}' has no parent flow`);
      if (level > prev + 1) fail(line, `'${keyword}' must be one level deeper than its parent`);
    }
  }
}

function dangling({ line, name }: { line: number; name: string }): never {
  return fail(line, `read model {${name}} informs nothing`);
}

interface Acc {
  /** Flows, whens, afters and reactions, in source order. */
  steps: Flat[];
  /** Top-level hotspots and sections. */
  board: (Hotspot | Section)[];
  /** Read models waiting for the step they inform. */
  pending: (ReadModel & { level: number })[];
  /** Index of the latest step in the current section. */
  current: number | null;
}

/**
 * A hotspot goes to the latest step in its section, which caused it; with
 * no such step it is top-level.
 */
function collect(acc: Acc, stmt: Stmt): Acc {
  switch (stmt.type) {
    case 'hotspot': {
      const hotspot: Hotspot = { type: 'hotspot', text: stmt.text, line: stmt.line };
      const step = acc.current === null ? undefined : acc.steps[acc.current]!;
      if (!step) acc.board.push(hotspot);
      else if (step.type === 'when' || step.type === 'after') {
        fail(stmt.line, `hotspot must follow a flow or reaction, not '${step.type}'`);
      } else step.hotspots.push(hotspot);
      return acc;
    }
    case 'section': {
      if (acc.pending[0]) dangling(acc.pending[0]);
      acc.board.push({ type: 'section', name: stmt.name, line: stmt.line });
      acc.current = null;
      return acc;
    }
    case 'read-model': {
      acc.pending.push({ type: 'read-model', name: stmt.name, line: stmt.line, level: stmt.level });
      return acc;
    }
    case 'when':
    case 'after': {
      checkLevel(acc.steps, stmt);
      const { level, ...rest } = stmt;
      acc.steps.push({ ...rest, level, reactions: [] });
      acc.current = acc.steps.length - 1;
      return acc;
    }
    case 'event': {
      checkLevel(acc.steps, stmt);
      if (acc.pending[0]) dangling(acc.pending[0]);
      acc.steps.push({ ...stmt, hotspots: [], reactions: [] });
      acc.current = acc.steps.length - 1;
      return acc;
    }
    case 'flow':
    case 'reaction': {
      checkLevel(acc.steps, stmt);
      const deeper = acc.pending.find((rm) => rm.level > stmt.level);
      if (deeper) dangling(deeper);
      const { level, ...rest } = stmt;
      acc.steps.push({
        ...rest,
        level,
        informedBy: acc.pending.map(({ level: _, ...rm }) => rm),
        hotspots: [],
        reactions: [],
      } as Flat);
      acc.pending = [];
      acc.current = acc.steps.length - 1;
      return acc;
    }
  }
}

type Node = Flow | Event | When | Step;

/**
 * Turns a flat list of steps into a tree, each step taking the deeper steps
 * that follow it as reactions.
 */
function nest(steps: Flat[], level: number): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < steps.length) {
    const { level: _, ...step } = steps[i]!;
    let j = i + 1;
    while (j < steps.length && steps[j]!.level > level) j++;
    out.push({ ...step, reactions: nest(steps.slice(i + 1, j), level + 1) as Step[] });
    i = j;
  }
  return out;
}

function* allSteps(trees: Node[]): Generator<Node> {
  for (const t of trees) {
    yield t;
    yield* allSteps(t.reactions);
  }
}

/** Each 'when' and 'after' needs reactions, and the events they name must exist. */
function checkTriggers(trees: Node[]): void {
  const known = new Set<string>();
  for (const s of allSteps(trees)) {
    if (s.type === 'flow' || s.type === 'reaction') known.add(s.event);
    if (s.type === 'event') known.add(s.name);
  }
  for (const s of allSteps(trees)) {
    if (s.type !== 'when' && s.type !== 'after') continue;
    if (s.reactions.length === 0) fail(s.line, `'${s.type}' has no reactions`);
    if (s.type === 'when' && !known.has(s.event)) {
      fail(s.line, `'when' refers to unknown event ${s.event}`);
    }
    if (s.type === 'after' && s.unless !== undefined && !known.has(s.unless)) {
      fail(s.line, `'unless' refers to unknown event ${s.unless}`);
    }
  }
}

/**
 * Parses estorm text into top-level items (flows, events, whens, sections and
 * board hotspots), in source order. Flows and reactions nest their reactions; an
 * 'after' sits among them, holding the reactions it delays.
 */
export function parse(text: string): Board {
  const acc = text
    .split(/\r?\n/)
    .map((line, i) => classify(i + 1, line))
    .filter((s): s is Stmt => s !== null)
    .reduce(collect, { steps: [], board: [], pending: [], current: null } as Acc);
  const trees = nest(acc.steps, 0);
  if (acc.pending[0]) dangling(acc.pending[0]);
  checkTriggers(trees);
  return [...(trees as (Flow | Event | When)[]), ...acc.board].sort((a, b) => a.line - b.line);
}
