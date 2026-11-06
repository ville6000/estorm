/**
 * Causes and effects of a line of a board: the step on it, the steps that
 * led to it and the steps it leads to, so the browser editor can pick them
 * out on a large board.
 *
 * A step is a flow, a reaction or an event on its own line. It leads to the
 * reactions under it, also through 'after', and to the reactions of every
 * 'when' that names one of its events. An 'unless' is not a cause, since it
 * cancels the reactions it delays, so the trace lists those on their own.
 */
import type { Board, Event, Flow, Reaction, Step } from './parser.ts';

export interface Trace {
  /** Source lines of the steps traced: the one on the line, or each a 'when' or 'after' there holds. */
  focus: Set<number>;
  /** Source lines of the focus and of every step that leads to it or that it leads to. */
  steps: Set<number>;
  /** Source lines of those steps' stickies: their own, and their read models' and hotspots'. */
  lines: Set<number>;
  /** Source lines of the delayed reactions an event of the focus cancels with 'unless'. */
  cancelled: Set<number>;
}

interface Node {
  line: number;
  events: string[];
  /** Lines of its read models, rules and hotspots, which belong to it. */
  parts: number[];
  causes: Node[];
  effects: Node[];
}

/** Adds VALUE to the list at KEY of MAP. */
function push<K, V>(map: Map<K, V[]>, key: K, ...values: V[]): void {
  map.set(key, [...(map.get(key) ?? []), ...values]);
}

/** Everything reachable from START through NEXT, START included. */
function reach(start: Node[], next: (n: Node) => Node[]): Set<Node> {
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length) {
    for (const n of next(queue.pop()!)) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/** The causes and effects of the step on LINE of BOARD; null when no step is there. */
export function trace(board: Board, line: number): Trace | null {
  /** Source line -> the steps it stands for. */
  const at = new Map<number, Node[]>();
  const producers = new Map<string, Node[]>();
  /** Event -> the delayed reactions it cancels. */
  const cancels = new Map<string, number[]>();
  const link = (cause: Node, effect: Node) => {
    cause.effects.push(effect);
    effect.causes.push(cause);
  };

  /** The node of STEP, with the steps under it. */
  const visit = (step: Flow | Reaction | Event): Node => {
    const events = step.type === 'event' ? [step.name] : step.events;
    const parts = [...(step.type === 'event' ? [] : [...step.informedBy, ...step.rules]), ...step.hotspots];
    const node: Node = { line: step.line, events, parts: parts.map((p) => p.line), causes: [], effects: [] };
    for (const l of [node.line, ...node.parts]) push(at, l, node);
    for (const e of events) push(producers, e, node);
    for (const r of under(step.reactions)) link(node, r);
    return node;
  };
  /** The nodes of the reactions in STEPS, through 'after'; the line of an 'after' stands for its reactions. */
  const under = (steps: Step[]): Node[] =>
    steps.flatMap((s) => {
      if (s.type === 'reaction') return [visit(s)];
      const delayed = under(s.reactions);
      push(at, s.line, ...delayed);
      if (s.unless !== undefined) push(cancels, s.unless, ...delayed.map((n) => n.line));
      return delayed;
    });

  // A 'when' may name an event produced further down, so they are linked once every step is known.
  const whens: [string[], Node[]][] = [];
  for (const item of board) {
    if (item.type === 'flow' || item.type === 'event') visit(item);
    else if (item.type === 'when') {
      const reactions = under(item.reactions);
      push(at, item.line, ...reactions);
      whens.push([item.events, reactions]);
    }
  }
  for (const [events, reactions] of whens) {
    for (const cause of events.flatMap((e) => producers.get(e) ?? [])) for (const r of reactions) link(cause, r);
  }

  const focus = at.get(line);
  if (!focus) return null;
  const all = [...new Set([...reach(focus, (n) => n.causes), ...reach(focus, (n) => n.effects)])];
  return {
    focus: new Set(focus.map((n) => n.line)),
    steps: new Set(all.map((n) => n.line)),
    lines: new Set(all.flatMap((n) => [n.line, ...n.parts])),
    cancelled: new Set(focus.flatMap((n) => n.events.flatMap((e) => cancels.get(e) ?? []))),
  };
}
