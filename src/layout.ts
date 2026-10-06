/**
 * Places AST stickies on the board. Time runs left to right on one axis
 * shared by all sections; every flow and reaction gets its own row,
 * consecutive events on their own share one, and a reaction starts under the
 * event that triggered it. Sections are horizontal swimlanes, top to bottom
 * in order of first appearance, as in the timeline view. A 'when' reaction is
 * linked to each event it names by a dashed arrow; in another lane it starts
 * right of those events, on the next free row of its own lane. Nothing at the
 * top level of a lane starts left of what is above it.
 */
import type { After, Board, Event, Flow, Hotspot, Reaction, Step, When } from './parser.ts';
import { maxOf, ruled } from './text.ts';

export const STICKY_W = 150;
export const STICKY_H = 100;
export const GAP_X = 30;
export const GAP_Y = 40;
export const FLOW_GAP = 40;
export const MARGIN = 20;
export const LANE_LABEL_H = 36;
export const LANE_PAD = 30;
/** Between swimlanes. */
export const SWIMLANE_GAP = 20;

export type Kind =
  'read-model' | 'actor' | 'schedule' | 'policy' | 'command' | 'aggregate' | 'external' | 'event' | 'hotspot';

export interface Sticky {
  kind: Kind;
  text: string;
  /** Source line, for error messages and editor features. */
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Business rules an aggregate enforces, listed under its name. */
  rules?: string[];
}

export type Point = [number, number];
export type Path = Point[];

export interface Lane {
  name: string;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  stickies: Sticky[];
  /** Arrows within a row, and from an event to its reactions. */
  arrows: Path[];
  /** From an event to the policies of each 'when' that names it. */
  links: Path[];
  /** From the 'unless' event of an 'after' to the policies it cancels. */
  cancels: Path[];
  /** Named sections, as full-height bands. */
  lanes: Lane[];
  /** The areas drawn on the board's background: one per lane, with nothing between them. */
  panels: Rect[];
}

function sticky(kind: Kind, text: string, line: number, x: number, y: number): Sticky {
  return { kind, text, line, x, y, w: STICKY_W, h: STICKY_H };
}

function colX(col: number): number {
  return col * (STICKY_W + GAP_X);
}

/** Row top -> row bottom: rules can make an aggregate taller than the rest of its row. */
type Bottoms = Map<number, number>;

function addBottoms(bottoms: Bottoms, stickies: Sticky[]): void {
  for (const s of stickies) bottoms.set(s.y, Math.max(bottoms.get(s.y) ?? -Infinity, s.y + s.h));
}

/** Straight arrow from the right side of A to the left side of B. */
function arrow(a: Sticky, b: Sticky): Path {
  const y = a.y + 0.5 * STICKY_H;
  return [
    [a.x + a.w, y],
    [b.x, y],
  ];
}

/**
 * Elbow arrow from the bottom of event E, whose row ends at BOTTOM, into
 * POLICY, whose row starts at GROUP_X (read models touch the policy on its left). A policy on the next
 * row is entered straight from above; otherwise the arrow runs down a rail
 * left of the row, then over the row into the top of the policy. Sibling
 * reactions share the rail; OFFSET shifts the route so links run beside it.
 * CLEAR, if given, moves the rail off any sticky between its ends.
 */
function branch(e: Sticky, bottom: number, policy: Sticky, groupX: number, offset = 0, clear?: Clear): Path {
  const midX = e.x + 0.5 * STICKY_W + 2 * offset;
  const below = bottom + 0.5 * GAP_Y + offset;
  const above = policy.y - 0.5 * GAP_Y + offset;
  const px = policy.x + 0.5 * STICKY_W + 2 * offset;
  const preferred = groupX - 0.5 * GAP_X - offset;
  const rail = clear ? clear(preferred, Math.min(below, above), Math.max(below, above)) : preferred;
  return [
    [midX, e.y + STICKY_H],
    [midX, below],
    ...(below === above
      ? [[px, below] as Point]
      : [[rail, below] as Point, [rail, above] as Point, [px, above] as Point]),
    [px, policy.y],
  ];
}

/** What a reaction reacts to. */
interface Trigger {
  /** The names of the events, any of which triggers it: several only for a 'when'. */
  events: string[];
  /** The event's sticky; absent when it is placed elsewhere (a 'when'). */
  sticky?: Sticky;
  /** The 'after' that delays the reaction. */
  after?: After;
}

/** "A", "A or B", "A, B or C". */
function anyOf(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function policyText({ events, after }: Trigger): string {
  const text = anyOf(events);
  if (!after) return `whenever ${text}`;
  return `⏰ ${after.duration} after ${text}${after.unless ? `, unless ${after.unless}` : ''}`;
}

type Row = [Kind, string, number][];

/** [kind, text, line] for each sticky of STEP's row, in time order. */
function chain(step: Flow | Reaction, trigger: Trigger | undefined): Row {
  const { line } = step;
  const flow = step.type === 'flow' ? step : undefined;
  const lead: Row = trigger
    ? [['policy', policyText(trigger), line]]
    : flow?.schedule !== undefined
      ? [['schedule', `⏰ every ${flow.schedule}`, line]]
      : flow?.actor !== undefined
        ? [['actor', flow.actor, line]]
        : [];
  return [
    ...step.informedBy.map((rm): [Kind, string, number] => ['read-model', rm.name, rm.line]),
    ...lead,
    ['command', step.command, line],
    ...step.via.map((v): [Kind, string, number] => [v.type, v.name, line]),
    ['event', step.event, line],
  ];
}

/** Kinds that touch the sticky after them: read models, actor or policy, and their command form one group. */
const GROUP_KINDS = new Set<Kind>(['read-model', 'actor', 'schedule', 'policy']);

/** Lane-local x of each sticky of a row of KINDS starting at X0. */
function rowXs(kinds: Kind[], x0: number): number[] {
  const xs = [x0];
  for (const kind of kinds.slice(0, -1)) {
    xs.push(xs.at(-1)! + STICKY_W + (GROUP_KINDS.has(kind) ? 0 : GAP_X));
  }
  return xs;
}

/** Arrows between the stickies of a row, from the command on. */
function flowArrows(placed: Sticky[]): Path[] {
  const from = placed.slice(placed.findIndex((s) => !GROUP_KINDS.has(s.kind)));
  return from.slice(1).map((s, i) => arrow(from[i]!, s));
}

type LaneKey = string | null;

/** A link whose event may not be placed yet; drawn once the layout is done. */
interface PendingLink {
  event: string;
  policy: Sticky;
  groupX: number;
  kind: 'link' | 'cancel';
}

/** A lane during a pass, in lane-local x. */
interface LaneBoard {
  key: LaneKey;
  name: string | null;
  line: number | null;
  y: number;
  stickies: Sticky[];
  /** Of STICKIES; add them with addStickies to keep it current. */
  bottoms: Bottoms;
  arrows: Path[];
  pendingLinks: PendingLink[];
  /** Swimlanes only: where the last top-level item starts; the next starts no further left. */
  minX: number;
}

function addStickies(lane: LaneBoard, stickies: Sticky[]): void {
  lane.stickies.push(...stickies);
  addBottoms(lane.bottoms, stickies);
}

/**
 * Places STEP on the next free row with its actor or policy at lane-local X,
 * then its reactions below it, starting under its event. TRIGGER is what a
 * reaction reacts to, undefined for a flow. An 'after' has no row: it passes
 * the trigger on to its reactions, delayed, and their policies get a cancel
 * link from its 'unless' event.
 */
function placeStep(lane: LaneBoard, step: Flow | Step, x: number, trigger?: Trigger): void {
  if (step.type === 'after') {
    for (const r of step.reactions) placeStep(lane, r, x, { ...trigger!, after: step });
  } else {
    placeRow(lane, step, x, trigger);
  }
}

function placeRow(lane: LaneBoard, step: Flow | Reaction, x: number, trigger?: Trigger): void {
  const { y } = lane;
  const items = chain(step, trigger);
  const start = Math.max(0, x - STICKY_W * step.informedBy.length);
  const xs = rowXs(
    items.map(([kind]) => kind),
    start,
  );
  const placed = items.map(([kind, text, line], i) => sticky(kind, text, line, xs[i]!, y));
  const rules = step.rules.map((r) => r.text);
  const aggregate = placed.find((s) => s.kind === 'aggregate');
  if (aggregate && rules.length) {
    aggregate.rules = rules;
    aggregate.h = Math.max(STICKY_H, ruled(aggregate.text, rules, aggregate.w).height);
  }
  const event = placed.at(-1)!;
  const hotspots = step.hotspots.map((h: Hotspot, i) => sticky('hotspot', h.text, h.line, event.x + colX(i + 1), y));
  addStickies(lane, [...placed, ...hotspots]);
  lane.arrows.push(...flowArrows(placed));
  lane.y += maxOf(placed.map((s) => s.h)) + GAP_Y;

  if (trigger) {
    const policy = placed[step.informedBy.length]!;
    if (trigger.sticky) {
      lane.arrows.push(branch(trigger.sticky, lane.bottoms.get(trigger.sticky.y)!, policy, start));
    } else {
      for (const event of trigger.events) lane.pendingLinks.push({ event, policy, groupX: start, kind: 'link' });
    }
    const unless = trigger.after?.unless;
    if (unless !== undefined) {
      lane.pendingLinks.push({ event: unless, policy, groupX: start, kind: 'cancel' });
    }
  }
  for (const r of step.reactions) placeStep(lane, r, event.x, { events: [event.text], sticky: event });
}

/**
 * Places EVENTS on one row, left to right, each followed by its hotspots;
 * then the reactions of the last, starting under it. Only the last may have
 * reactions: they end the row.
 */
function placeEvents(lane: LaneBoard, events: Event[]): void {
  const { y } = lane;
  let x = lane.minX;
  let last: Sticky | undefined;
  for (const e of events) {
    last = sticky('event', e.name, e.line, x, y);
    const hotspots = e.hotspots.map((h, i) => sticky('hotspot', h.text, h.line, x + colX(i + 1), y));
    addStickies(lane, [last, ...hotspots]);
    x += colX(hotspots.length + 1);
  }
  lane.y += STICKY_H + GAP_Y;
  for (const r of events.at(-1)?.reactions ?? []) {
    placeStep(lane, r, last!.x, { events: [last!.text], sticky: last! });
  }
}

interface Position {
  lane: LaneKey;
  x: number;
  /** Source line of the event. */
  line: number;
}

/** Event name -> position of its first sticky, from LANES of a pass. */
function eventPositions(lanes: LaneBoard[]): Map<string, Position> {
  const m = new Map<string, Position>();
  for (const lane of lanes) {
    for (const s of lane.stickies) {
      if (s.kind === 'event' && !m.has(s.text)) m.set(s.text, { lane: lane.key, x: s.x, line: s.line });
    }
  }
  return m;
}

/**
 * Places the reactions of a 'when'. They start under the latest of its
 * events in the lane, or right of the latest in another lane, whichever is
 * further right. Positions come from an earlier pass (unknown at first).
 *
 * What follows in the lane starts no further left, but only after a 'when'
 * on events earlier in the file: one on a later event would push that
 * event's own flow right, and itself with it, without end.
 */
function placeWhen(lane: LaneBoard, { events, reactions, line }: When, positions: Map<string, Position>): void {
  const known = events.flatMap((e) => positions.get(e) ?? []);
  const xs = known.map((pos) => (pos.lane === lane.key ? pos.x : pos.x + colX(1)));
  const x = Math.max(...xs, lane.minX);
  for (const r of reactions) placeStep(lane, r, x, { events });
  if (known.length === events.length && known.every((pos) => pos.line < line)) lane.minX = x;
}

function placeHotspotRow(lane: LaneBoard, hotspots: Hotspot[]): void {
  addStickies(
    lane,
    hotspots.map((h, i) => sticky('hotspot', h.text, h.line, lane.minX + colX(i), lane.y)),
  );
  lane.y += STICKY_H + FLOW_GAP;
}

/**
 * One layout pass, in lane-local x. Items before the first section go to an
 * unnamed lane (key null). Consecutive top-level hotspots share a row, and so
 * do consecutive events.
 */
function placeAll(board: Board, positions: Map<string, Position>): LaneBoard[] {
  const top = MARGIN + (board.some((i) => i.type === 'section') ? LANE_LABEL_H : 0);
  const lanes = new Map<LaneKey, LaneBoard>();
  const lane = (key: LaneKey, name: string | null = null, line: number | null = null) => {
    let l = lanes.get(key);
    if (!l) {
      l = { key, name, line, y: top, stickies: [], bottoms: new Map(), arrows: [], pendingLinks: [], minX: 0 };
      lanes.set(key, l);
    }
    return l;
  };

  let current: LaneKey = null;
  let hotspots: Hotspot[] = [];
  const flushHotspots = () => {
    if (hotspots.length) placeHotspotRow(lane(current), hotspots);
    hotspots = [];
  };
  let events: Event[] = [];
  const flushEvents = () => {
    if (events.length) {
      placeEvents(lane(current), events);
      lane(current).y += FLOW_GAP;
    }
    events = [];
  };
  for (const item of board) {
    if (item.type === 'hotspot') {
      flushEvents();
      hotspots.push(item);
      continue;
    }
    flushHotspots();
    if (item.type === 'event') {
      events.push(item);
      if (item.reactions.length) flushEvents();
      continue;
    }
    flushEvents();
    switch (item.type) {
      case 'section':
        current = item.name;
        lane(current, item.name, item.line);
        break;
      case 'flow':
        placeStep(lane(current), item, lane(current).minX);
        lane(current).y += FLOW_GAP;
        break;
      case 'when':
        placeWhen(lane(current), item, positions);
        lane(current).y += FLOW_GAP;
        break;
    }
  }
  flushHotspots();
  flushEvents();
  return [...lanes.values()];
}

function shift(dx: number, dy: number, lane: LaneBoard): LaneBoard {
  const move = (s: Sticky): Sticky => ({ ...s, x: s.x + dx, y: s.y + dy });
  return {
    ...lane,
    stickies: lane.stickies.map(move),
    arrows: lane.arrows.map((path) => path.map(([x, y]): Point => [x + dx, y + dy])),
    pendingLinks: lane.pendingLinks.map((l) => ({ ...l, policy: move(l.policy), groupX: l.groupX + dx })),
  };
}

/** X near X, or X itself, where a vertical line from Y1 to Y2 crosses no sticky. */
type Clear = (x: number, y1: number, y2: number) => number;

/** Room kept between a rail and a sticky; hotspots are tilted. */
const RAIL_ROOM = 6;

/**
 * A Clear for STICKIES. A rail on a sticky moves into the gap left of it,
 * and on until it is clear; failing that, right of the stickies instead.
 */
function clearOf(stickies: Sticky[]): Clear {
  const tallest = maxOf(
    stickies.map((s) => s.h),
    0,
  );
  const on = (x: number, s: Sticky) => x > s.x - RAIL_ROOM && x < s.x + s.w + RAIL_ROOM;
  // Rails are tried at few distinct x, so the stickies at each are found once, top to bottom.
  const columns = new Map<number, Sticky[]>();
  const column = (x: number): Sticky[] => {
    let c = columns.get(x);
    if (!c) {
      c = stickies.filter((s) => on(x, s)).sort((a, b) => a.y - b.y);
      columns.set(x, c);
    }
    return c;
  };
  /** A sticky at X that overlaps Y1..Y2 vertically, if any. */
  const blocker = (x: number, y1: number, y2: number): Sticky | undefined => {
    const c = column(x);
    let lo = 0;
    let hi = c.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid]!.y < y1 - tallest) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < c.length && c[i]!.y < y2; i++) if (c[i]!.y + c[i]!.h > y1) return c[i];
    return undefined;
  };
  return (x, y1, y2) => {
    for (const step of [-1, 1]) {
      let rail = x;
      while (rail >= 0) {
        const s = blocker(rail, y1, y2);
        if (!s) return rail;
        rail = step < 0 ? s.x - 0.5 * GAP_X : s.x + s.w + 0.5 * GAP_X;
      }
    }
    return x;
  };
}

/** Elbow arrow from the first event sticky named EVENT into POLICY. Cancel links run beside 'when' links. */
function link(
  events: Map<string, Sticky>,
  bottoms: Bottoms,
  { event, policy, groupX, kind }: PendingLink,
  clear: Clear,
): Path {
  const e = events.get(event)!;
  return branch(e, bottoms.get(e.y)!, policy, groupX, kind === 'cancel' ? -6 : 6, clear);
}

const MAX_PASSES = 10;

/** Stickies and paths of lanes PLACED on the board, with the links between them drawn round stickies. */
function connect(placed: LaneBoard[]): Pick<Layout, 'stickies' | 'arrows' | 'links' | 'cancels'> {
  const stickies = placed.flatMap((l) => l.stickies);
  const arrows = placed.flatMap((l) => l.arrows);
  const events = new Map<string, Sticky>();
  for (const s of stickies) if (s.kind === 'event' && !events.has(s.text)) events.set(s.text, s);
  // A board from parseAll may name an event that was on a broken line; such links are left out.
  const pending = placed.flatMap((l) => l.pendingLinks).filter((l) => events.has(l.event));
  const bottoms: Bottoms = new Map();
  addBottoms(bottoms, stickies);
  const rails = clearOf(stickies);
  const links = pending.filter((l) => l.kind === 'link').map((l) => link(events, bottoms, l, rails));
  const cancels = pending.filter((l) => l.kind === 'cancel').map((l) => link(events, bottoms, l, rails));
  return { stickies, arrows, links, cancels };
}

/** The bottom of everything in PARTS. */
function bottomOf({ stickies, arrows, links, cancels }: Pick<Layout, 'stickies' | 'arrows' | 'links' | 'cancels'>) {
  return maxOf([...stickies.map((s) => s.y + s.h), ...[...arrows, ...links, ...cancels].flat().map(([, y]) => y)], 0);
}

/** Lanes placed as bands stacked top to bottom, on one time axis. */
function swimlanes(lanes: LaneBoard[]): Layout {
  const bandHs = lanes.map(
    (l) => maxOf([...l.stickies.map((s) => s.y + s.h), ...l.arrows.flat().map(([, y]) => y)], 0) + GAP_Y,
  );
  const bandYs = bandHs.reduce<number[]>((ys, h) => [...ys, ys.at(-1)! + h + SWIMLANE_GAP], [0]);
  const parts = connect(lanes.map((l, i) => shift(LANE_PAD, bandYs[i]!, l)));
  const width = parts.stickies.length
    ? LANE_PAD +
      maxOf([...parts.stickies.map((s) => s.x + s.w), ...[...parts.links, ...parts.cancels].flat().map(([x]) => x)])
    : 0;
  const height = Math.max(bandHs.length ? bandYs.at(-1)! - SWIMLANE_GAP : 0, MARGIN + bottomOf(parts));
  return {
    width,
    height,
    ...parts,
    lanes: lanes.flatMap((l, i) =>
      l.name === null ? [] : [{ name: l.name, line: l.line!, x: 0, y: bandYs[i]!, w: width, h: bandHs[i]! }],
    ),
    panels: bandHs.map((h, i) => ({ x: 0, y: bandYs[i]!, w: width, h })),
  };
}

/**
 * Lays out a parsed board. Lays out until event positions settle: a 'when'
 * may refer to an event placed further down, or to one placed by another
 * 'when'.
 */
export function layout(board: Board): Layout {
  let positions = new Map<string, Position>();
  let lanes = placeAll(board, positions);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = eventPositions(lanes);
    if (JSON.stringify([...next]) === JSON.stringify([...positions])) break;
    positions = next;
    lanes = placeAll(board, positions);
  }
  return swimlanes(lanes);
}
