/**
 * The timeline view: only the events of a board, on one time axis shared by
 * all sections, as in Big Picture Event Storming. Sections are horizontal
 * swimlanes, top to bottom in order of first appearance. An event's column
 * is the longest chain of causes before it: an event comes after the event
 * its policy reacts to (each of them, for a 'when' on several), and after the
 * event before it in a run of events.
 * Within a section, a flow, run or 'when' is never left of the one above it.
 * Events of a section that share a column stack, in source order.
 */
import type { Board, Step } from './parser.ts';
import type { Lane, Layout, Path, Point, Sticky } from './layout.ts';
import { GAP_Y, LANE_LABEL_H, LANE_PAD, MARGIN, STICKY_H, STICKY_W, SWIMLANE_GAP } from './layout.ts';
import { maxOf } from './text.ts';

/** Between columns: room for the arrows that turn there. */
export const COL_GAP = 60;
/** How far links run beside arrows. */
const LINK_OFFSET = 10;

type LaneKey = string | null;

interface Node {
  name: string;
  line: number;
  lane: LaneKey;
}

interface Edge {
  from: string;
  to: string;
  /** 1 when TO happens after FROM, 0 when it is merely no earlier. */
  weight: 0 | 1;
  /** How it is drawn: an arrow within a flow, a dashed 'when' link, or not at all. */
  draw?: 'arrow' | 'link';
}

interface Graph {
  nodes: Map<string, Node>;
  edges: Edge[];
  /** Section names in order of first appearance; null for content before the first section. */
  lanes: LaneKey[];
}

function collect(board: Board): Graph {
  const g: Graph = { nodes: new Map(), edges: [], lanes: [] };
  let lane: LaneKey = null;
  const produce = (name: string, line: number) => {
    if (!g.nodes.has(name)) g.nodes.set(name, { name, line, lane });
    if (!g.lanes.includes(g.nodes.get(name)!.lane)) g.lanes.push(g.nodes.get(name)!.lane);
  };
  /** Steps of LIST, each reacting to any of PARENTS. */
  const steps = (parents: string[], list: Step[], draw: 'arrow' | 'link') => {
    for (const s of list) {
      if (s.type === 'after') {
        steps(parents, s.reactions, draw);
        continue;
      }
      for (const to of s.events) {
        produce(to, s.line);
        for (const from of parents) g.edges.push({ from, to, weight: 1, draw });
      }
      steps(s.events, s.reactions, 'arrow');
    }
  };
  /** First event a step list produces, through 'after'. */
  const first = (list: Step[]): string | undefined => {
    for (const s of list) {
      const e = s.type === 'after' ? first(s.reactions) : s.events[0];
      if (e !== undefined) return e;
    }
    return undefined;
  };

  // The first event of the previous flow, run or 'when' of each section.
  const previous = new Map<LaneKey, string>();
  const after = (event: string | undefined) => {
    if (event === undefined) return;
    const prev = previous.get(lane);
    if (prev !== undefined && prev !== event) g.edges.push({ from: prev, to: event, weight: 0 });
    previous.set(lane, event);
  };
  // The last event of the current run of events, if the run goes on.
  let run: string | undefined;

  for (const item of board) {
    if (item.type !== 'event') run = undefined;
    switch (item.type) {
      case 'section':
        lane = item.name;
        break;
      case 'flow':
        for (const e of item.events) produce(e, item.line);
        after(item.events[0]);
        steps(item.events, item.reactions, 'arrow');
        break;
      case 'event':
        produce(item.name, item.line);
        if (run === undefined) after(item.name);
        else g.edges.push({ from: run, to: item.name, weight: 1 });
        steps([item.name], item.reactions, 'arrow');
        run = item.reactions.length ? undefined : item.name;
        break;
      case 'when':
        after(first(item.reactions));
        steps(item.events, item.reactions, 'link');
        break;
    }
  }
  return g;
}

/** Edges that close a cycle, found depth-first from the nodes in source order. */
function backEdges({ nodes, edges }: Graph): Set<Edge> {
  const out = new Map<string, Edge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const back = new Set<Edge>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (n: string) => {
    state.set(n, 'open');
    for (const e of out.get(n) ?? []) {
      const s = state.get(e.to);
      if (s === 'open') back.add(e);
      else if (s === undefined) visit(e.to);
    }
    state.set(n, 'done');
  };
  for (const n of nodes.keys()) if (!state.has(n)) visit(n);
  return back;
}

/** Event name -> column: the longest path to it, ignoring edges that close a cycle. */
function columns(g: Graph): Map<string, number> {
  const back = backEdges(g);
  const edges = g.edges.filter((e) => !back.has(e));
  const col = new Map([...g.nodes.keys()].map((n) => [n, 0]));
  for (let i = 0; i <= g.nodes.size; i++) {
    let changed = false;
    for (const { from, to, weight } of edges) {
      if (col.get(from)! + weight > col.get(to)!) {
        col.set(to, col.get(from)! + weight);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return col;
}

/**
 * Elbow arrow from the right side of A to the left side of B, turning in
 * the gap before B's column. OFFSET shifts the route so links run beside
 * arrows instead of on top of them.
 */
function elbow(a: Sticky, b: Sticky, offset = 0): Path {
  const ay = a.y + 0.5 * a.h + offset;
  const by = b.y + 0.5 * b.h + offset;
  const start: Point = [a.x + a.w, ay];
  const end: Point = [b.x, by];
  if (ay === by) return [start, end];
  const mx = (b.x > a.x ? b.x - 0.5 * COL_GAP : a.x + a.w + 0.5 * COL_GAP) + offset;
  return [start, [mx, ay], [mx, by], end];
}

/** Lays out the timeline view of a parsed board. */
export function timeline(board: Board): Layout {
  const g = collect(board);
  const col = columns(g);
  const labelled = board.some((i) => i.type === 'section');
  const head = MARGIN + (labelled ? LANE_LABEL_H : 0);
  const pitch = STICKY_W + COL_GAP;

  const stickies: Sticky[] = [];
  const lanes: Lane[] = [];
  const bands: { key: LaneKey; y: number; h: number }[] = [];
  let y = 0;
  for (const key of g.lanes) {
    const nodes = [...g.nodes.values()].filter((n) => n.lane === key).sort((a, b) => a.line - b.line);
    const rowsUsed = new Map<number, number>();
    let rows = 0;
    for (const n of nodes) {
      const c = col.get(n.name)!;
      const row = rowsUsed.get(c) ?? 0;
      rowsUsed.set(c, row + 1);
      rows = Math.max(rows, row + 1);
      const x = LANE_PAD + c * pitch;
      stickies.push({
        kind: 'event',
        text: n.name,
        line: n.line,
        x,
        y: y + head + row * (STICKY_H + GAP_Y),
        w: STICKY_W,
        h: STICKY_H,
      });
    }
    const h = head + rows * STICKY_H + (rows - 1) * GAP_Y + MARGIN;
    bands.push({ key, y, h });
    y += h + SWIMLANE_GAP;
  }

  const width = stickies.length ? maxOf(stickies.map((s) => s.x + s.w)) + LANE_PAD : 0;
  for (const b of bands) {
    if (b.key !== null) {
      const section = board.find((i) => i.type === 'section' && i.name === b.key)!;
      lanes.push({ name: b.key, line: section.line, x: 0, y: b.y, w: width, h: b.h });
    }
  }

  const at = new Map(stickies.map((s) => [s.text, s]));
  const arrows: Path[] = [];
  const links: Path[] = [];
  const drawn = new Set<string>();
  for (const e of g.edges) {
    const key = `${e.from}\n${e.to}`;
    if (!e.draw || e.from === e.to || drawn.has(key)) continue;
    const a = at.get(e.from);
    if (!a) continue; // a 'when' on an event nothing produces is a parse error, but be safe
    drawn.add(key);
    const b = at.get(e.to)!;
    const sameLane = g.nodes.get(e.from)!.lane === g.nodes.get(e.to)!.lane;
    if (e.draw === 'arrow' && sameLane) arrows.push(elbow(a, b));
    else links.push(elbow(a, b, LINK_OFFSET));
  }

  const height = bands.length ? y - SWIMLANE_GAP : MARGIN;
  const panels = bands.map((b) => ({ x: 0, y: b.y, w: width, h: b.h }));
  return { width, height, stickies, arrows, links, cancels: [], lanes, panels };
}
