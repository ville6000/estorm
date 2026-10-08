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

/** A business rule the aggregate of a flow or reaction enforces. */
export interface Rule {
  type: 'rule';
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
  /** The events the command produces: one, or several possible outcomes. */
  events: string[];
}

/** An actor (or a schedule, or nobody yet) issues a command, producing one or more events. */
export interface Flow extends Chain {
  type: 'flow';
  line: number;
  informedBy: ReadModel[];
  /** Who issues the command. Absent for a schedule, or when not known yet. */
  actor?: string;
  /** When the command runs, e.g. "night at 02:00". Absent for an actor. */
  schedule?: string;
  /** Rules its aggregate enforces. */
  rules: Rule[];
  hotspots: Hotspot[];
  reactions: Step[];
}

/** A policy reacts to the event of its parent, issuing a command. */
export interface Reaction extends Chain {
  type: 'reaction';
  line: number;
  informedBy: ReadModel[];
  /** Rules its aggregate enforces. */
  rules: Rule[];
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

/** Reacts to any of several events by name, usually ones from another section. */
export interface When {
  type: 'when';
  line: number;
  events: string[];
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
  const named = (type: Via['type'], raw: string): Item | null => {
    const name = raw.trim();
    return NAME.test(name) ? { type, name } : null;
  };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^\((.*)\)$/))) return named('aggregate', m[1]!);
  if ((m = s.match(/^\[(.*)\]$/))) return named('external', m[1]!);
  if (NAME.test(s)) return { type: 'name', name: s };
  return null;
}

/** `Command -> ... -> Event` or `... -> EventA, EventB` into {command, via, events}. */
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
  const events = event.name.split(',').map((e) => e.trim());
  if (events.includes('')) fail(line, 'empty event name in chain');
  const twice = events.find((e, i) => events.indexOf(e) !== i);
  if (twice !== undefined) fail(line, `chain names ${twice} twice`);
  return { command: command!.name, via: via as Via[], events };
}

/** A source line, classified, with its indentation level. */
type Stmt = { line: number; level: number } & (
  | { type: 'hotspot'; text: string }
  | { type: 'rule'; text: string }
  | { type: 'section'; name: string }
  | { type: 'read-model'; name: string }
  | { type: 'when'; events: string[] }
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
  if (text.startsWith('*')) {
    const t = text.slice(1).trim();
    if (t === '') fail(n, 'empty rule');
    return { ...base, type: 'rule', text: t };
  }
  // Not a regex: /^==\s*(.*?)\s*==$/ backtracks cubically on long runs of spaces.
  if (text.length >= 4 && text.startsWith('==') && text.endsWith('==')) {
    const name = text.slice(2, -2).trim();
    if (name === '') fail(n, 'empty section name');
    if (base.level > 0) fail(n, 'section must not be indented');
    return { ...base, type: 'section', name };
  }
  if ((m = text.match(/^\{([^{}]+)\}$/))) {
    return { ...base, type: 'read-model', name: m[1]!.trim() };
  }
  if ((m = text.match(/^when\s+(.+)$/))) {
    const events = m[1]!.split(',').map((e) => e.trim());
    if (events.includes('')) fail(n, "empty event name in 'when'");
    for (const event of events) checkEventName(n, 'when', event);
    const twice = events.find((e, i) => events.indexOf(e) !== i);
    if (twice !== undefined) fail(n, `'when' names ${twice} twice`);
    return { ...base, type: 'when', events };
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
  // The last colon ends the schedule: names have none, but times like 02:00 do.
  if ((m = text.match(/^every\s+(.+):\s*(.*)$/))) {
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
  if (text.includes('->')) {
    return { ...base, type: 'flow', ...parseChain(n, text) };
  }
  if (NAME.test(text)) {
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

function dangling({ line, name }: { line: number; name: string }): ParseError {
  return new ParseError(line, `read model {${name}} informs nothing`);
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
  /** Errors that don't stop the statement that found them. */
  errors: ParseError[];
}

/** Reports the read models still waiting, which inform nothing. */
function flushPending(acc: Acc): void {
  acc.errors.push(...acc.pending.map(dangling));
  acc.pending = [];
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
    case 'rule': {
      const step = acc.current === null ? undefined : acc.steps[acc.current]!;
      if (step?.type !== 'flow' && step?.type !== 'reaction') {
        fail(stmt.line, 'rule must follow a flow or reaction');
      }
      const aggregates = step.via.filter((v) => v.type === 'aggregate').length;
      if (aggregates === 0) fail(stmt.line, 'rule needs an (Aggregate) in its step');
      if (aggregates > 1) fail(stmt.line, 'rule is ambiguous: step has several aggregates');
      step.rules.push({ type: 'rule', text: stmt.text, line: stmt.line });
      return acc;
    }
    case 'section': {
      flushPending(acc);
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
      flushPending(acc);
      acc.steps.push({ ...stmt, hotspots: [], reactions: [] });
      acc.current = acc.steps.length - 1;
      return acc;
    }
    case 'flow':
    case 'reaction': {
      checkLevel(acc.steps, stmt);
      acc.errors.push(...acc.pending.filter((rm) => rm.level > stmt.level).map(dangling));
      const { level, ...rest } = stmt;
      acc.steps.push({
        ...rest,
        level,
        informedBy: acc.pending.filter((rm) => rm.level <= stmt.level).map(({ level: _, ...rm }) => rm),
        rules: [],
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

/**
 * A step with several events can't take 'then' or 'after': which event they
 * react to would be unclear. Each is an error, and is left out with what is
 * under it.
 */
function checkSeveral(trees: Node[]): ParseError[] {
  const errors: ParseError[] = [];
  for (const s of allSteps(trees)) {
    if ((s.type === 'flow' || s.type === 'reaction') && s.events.length > 1) {
      for (const r of s.reactions) {
        const keyword = r.type === 'after' ? 'after' : 'then';
        errors.push(new ParseError(r.line, `'${keyword}' can't follow several events; use 'when' with one of them`));
      }
      s.reactions = [];
    }
  }
  return errors;
}

/**
 * Each 'when' and 'after' needs reactions, and the events they name must
 * exist. An event named on a BROKEN line may exist, so it isn't reported.
 * Names can't hold arrows, brackets or colons, so the line is split on them.
 */
function checkTriggers(trees: Node[], broken: string[]): ParseError[] {
  const errors: ParseError[] = [];
  const maybe = new Set(broken.flatMap((raw) => raw.split(/->|[()[\]{}:]/).map((x) => x.trim())));
  const unknown = (line: number, keyword: string, event: string) => {
    if (!maybe.has(event)) {
      errors.push(new ParseError(line, `'${keyword}' refers to unknown event ${event}`));
    }
  };
  const known = new Set<string>();
  for (const s of allSteps(trees)) {
    if (s.type === 'flow' || s.type === 'reaction') for (const e of s.events) known.add(e);
    if (s.type === 'event') known.add(s.name);
  }
  for (const s of allSteps(trees)) {
    if (s.type !== 'when' && s.type !== 'after') continue;
    if (s.reactions.length === 0) errors.push(new ParseError(s.line, `'${s.type}' has no reactions`));
    if (s.type === 'when') for (const e of s.events) if (!known.has(e)) unknown(s.line, 'when', e);
    if (s.type === 'after' && s.unless !== undefined && !known.has(s.unless)) unknown(s.line, 'unless', s.unless);
  }
  return errors;
}

/** F's result, or undefined if it threw a ParseError, which goes to ERRORS. */
function attempt<T>(errors: ParseError[], f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    errors.push(e);
    return undefined;
  }
}

/** Hotspots and rules have no lines under them; the lines indented below belong to the step above. */
const isLeaf = (raw: string) => /^\s*[!*]/.test(raw);

/**
 * Parses as much of TEXT as it can, and returns every error, by line. A line
 * with an error is left out, and so are the lines indented under it, which
 * would only report that their parent is missing.
 */
export function parseAll(text: string): { board: Board; errors: ParseError[] } {
  const acc: Acc = { steps: [], board: [], pending: [], current: null, errors: [] };
  const broken: string[] = [];
  let brokenLevel: number | null = null;
  /** Leaves out the lines under the broken line RAW, and the read models it would take. */
  const breakAt = (raw: string, level: number) => {
    broken.push(raw);
    if (isLeaf(raw)) return;
    brokenLevel = level;
    acc.pending = acc.pending.filter((rm) => rm.level > level);
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const stmt = attempt(acc.errors, () => classify(i + 1, raw));
    if (stmt === undefined) return breakAt(raw, Math.floor(raw.match(/^ */)![0].length / 2));
    if (stmt === null) return;
    const { level } = stmt;
    if (brokenLevel !== null && level > brokenLevel) return;
    brokenLevel = null;
    if (!attempt(acc.errors, () => collect(acc, stmt))) breakAt(raw, level);
  });
  flushPending(acc);
  const trees = nest(acc.steps, 0);
  const several = checkSeveral(trees);
  const errors = [...acc.errors, ...several, ...checkTriggers(trees, broken)].sort((a, b) => a.line - b.line);
  const board = [...(trees as (Flow | Event | When)[]), ...acc.board].sort((a, b) => a.line - b.line);
  return { board, errors };
}

/**
 * Parses estorm text into top-level items (flows, events, whens, sections and
 * board hotspots), in source order. Flows and reactions nest their reactions; an
 * 'after' sits among them, holding the reactions it delays. Throws the first
 * error, by line; parseAll returns them all.
 */
export function parse(text: string): Board {
  const { board, errors } = parseAll(text);
  if (errors[0]) throw errors[0];
  return board;
}
