/**
 * Places AST stickies on the board. Time runs left to right; every flow and
 * reaction gets its own row, consecutive events on their own share one, and a reaction starts under the event that
 * triggered it. Sections are vertical lanes, side by side in order of first
 * appearance. A 'when' reaction is linked to the event it names by a dashed
 * arrow; in another lane it starts at the lane's left edge, level with that
 * event if the lane is free there.
 */
import type { After, Board, Event, Flow, Hotspot, Reaction, Step, When } from './parser.ts';

export const STICKY_W = 150;
export const STICKY_H = 100;
export const GAP_X = 30;
export const GAP_Y = 40;
export const FLOW_GAP = 40;
export const MARGIN = 20;
export const LANE_LABEL_H = 36;
export const LANE_PAD = 30;
export const LANE_GAP = 80;

export type Kind =
  | 'read-model'
  | 'actor'
  | 'schedule'
  | 'policy'
  | 'command'
  | 'aggregate'
  | 'external'
  | 'event'
  | 'hotspot';

export interface Sticky {
  kind: Kind;
  text: string;
  /** Source line, for error messages and editor features. */
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** From an event to the policies of a 'when' that names it. */
  links: Path[];
  /** From the 'unless' event of an 'after' to the policies it cancels. */
  cancels: Path[];
  /** Named sections, as full-height bands. */
  lanes: Lane[];
  /** The space between lanes. */
  gaps: Rect[];
}

function sticky(kind: Kind, text: string, line: number, x: number, y: number): Sticky {
  return { kind, text, line, x, y, w: STICKY_W, h: STICKY_H };
}

function colX(col: number): number {
  return col * (STICKY_W + GAP_X);
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
 * Elbow arrow from the bottom of event E into POLICY, whose row starts at
 * GROUP_X (read models touch the policy on its left). A policy on the next
 * row is entered straight from above; otherwise the arrow runs down a rail
 * left of the row, then over the row into the top of the policy. Sibling
 * reactions share the rail; OFFSET shifts the route so links run beside it.
 */
function branch(e: Sticky, policy: Sticky, groupX: number, offset = 0): Path {
  const midX = e.x + 0.5 * STICKY_W + 2 * offset;
  const below = e.y + STICKY_H + 0.5 * GAP_Y + offset;
  const above = policy.y - 0.5 * GAP_Y + offset;
  const px = policy.x + 0.5 * STICKY_W + 2 * offset;
  const rail = groupX - 0.5 * GAP_X - offset;
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
  /** The event's name. */
  text: string;
  /** The event's sticky; absent when it is placed elsewhere (a 'when'). */
  sticky?: Sticky;
  /** The 'after' that delays the reaction. */
  after?: After;
}

function policyText({ text, after }: Trigger): string {
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
  arrows: Path[];
  pendingLinks: PendingLink[];
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
  const event = placed.at(-1)!;
  const hotspots = step.hotspots.map((h: Hotspot, i) =>
    sticky('hotspot', h.text, h.line, event.x + colX(i + 1), y),
  );
  lane.stickies.push(...placed, ...hotspots);
  lane.arrows.push(...flowArrows(placed));
  lane.y += STICKY_H + GAP_Y;

  if (trigger) {
    const policy = placed[step.informedBy.length]!;
    if (trigger.sticky) {
      lane.arrows.push(branch(trigger.sticky, policy, start));
    } else {
      lane.pendingLinks.push({ event: trigger.text, policy, groupX: start, kind: 'link' });
    }
    const unless = trigger.after?.unless;
    if (unless !== undefined) {
      lane.pendingLinks.push({ event: unless, policy, groupX: start, kind: 'cancel' });
    }
  }
  for (const r of step.reactions) placeStep(lane, r, event.x, { text: event.text, sticky: event });
}

/**
 * Places EVENTS on one row, left to right, each followed by its hotspots;
 * then the reactions of the last, starting under it. Only the last may have
 * reactions: they end the row.
 */
function placeEvents(lane: LaneBoard, events: Event[]): void {
  const { y } = lane;
  let x = 0;
  let last: Sticky | undefined;
  for (const e of events) {
    last = sticky('event', e.name, e.line, x, y);
    const hotspots = e.hotspots.map((h, i) => sticky('hotspot', h.text, h.line, x + colX(i + 1), y));
    lane.stickies.push(last, ...hotspots);
    x += colX(hotspots.length + 1);
  }
  lane.y += STICKY_H + GAP_Y;
  for (const r of events.at(-1)?.reactions ?? []) {
    placeStep(lane, r, last!.x, { text: last!.text, sticky: last! });
  }
}

interface Position {
  lane: LaneKey;
  x: number;
  y: number;
}

/** Event name -> position of its first sticky, from LANES of a pass. */
function eventPositions(lanes: LaneBoard[]): Map<string, Position> {
  const m = new Map<string, Position>();
  for (const lane of lanes) {
    for (const s of lane.stickies) {
      if (s.kind === 'event' && !m.has(s.text)) m.set(s.text, { lane: lane.key, x: s.x, y: s.y });
    }
  }
  return m;
}

/**
 * Places the reactions of a 'when'. In the lane of its event they start
 * under the event; in another lane at its left edge, no higher than the
 * event. Positions come from an earlier pass (unknown at first).
 */
function placeWhen(lane: LaneBoard, { event, reactions }: When, positions: Map<string, Position>): void {
  const pos = positions.get(event);
  const same = pos !== undefined && pos.lane === lane.key;
  if (pos && !same) lane.y = Math.max(lane.y, pos.y);
  for (const r of reactions) placeStep(lane, r, same ? pos.x : 0, { text: event });
}

function placeHotspotRow(lane: LaneBoard, hotspots: Hotspot[]): void {
  lane.stickies.push(...hotspots.map((h, i) => sticky('hotspot', h.text, h.line, colX(i), lane.y)));
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
      l = { key, name, line, y: top, stickies: [], arrows: [], pendingLinks: [] };
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
        placeStep(lane(current), item, 0);
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

function laneWidth({ stickies }: LaneBoard): number {
  return Math.max(STICKY_W, ...stickies.map((s) => s.x + s.w));
}

function shift(dx: number, lane: LaneBoard): LaneBoard {
  const move = (s: Sticky): Sticky => ({ ...s, x: s.x + dx });
  return {
    ...lane,
    stickies: lane.stickies.map(move),
    arrows: lane.arrows.map((path) => path.map(([x, y]): Point => [x + dx, y])),
    pendingLinks: lane.pendingLinks.map((l) => ({ ...l, policy: move(l.policy), groupX: l.groupX + dx })),
  };
}

/** Elbow arrow from the first event sticky named EVENT into POLICY. Cancel links run beside 'when' links. */
function link(stickies: Sticky[], { event, policy, groupX, kind }: PendingLink): Path {
  const e = stickies.find((s) => s.kind === 'event' && s.text === event)!;
  return branch(e, policy, groupX, kind === 'cancel' ? -6 : 6);
}

const MAX_PASSES = 10;

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

  const bandWs = lanes.map((l) => laneWidth(l) + 2 * LANE_PAD);
  const bandXs = bandWs.reduce<number[]>((xs, w) => [...xs, xs.at(-1)! + w + LANE_GAP], [0]);
  const placed = lanes.map((l, i) => shift(bandXs[i]! + LANE_PAD, l));
  const stickies = placed.flatMap((l) => l.stickies);
  const arrows = placed.flatMap((l) => l.arrows);
  const pending = placed.flatMap((l) => l.pendingLinks);
  const links = pending.filter((l) => l.kind === 'link').map((l) => link(stickies, l));
  const cancels = pending.filter((l) => l.kind === 'cancel').map((l) => link(stickies, l));
  const width = bandWs.length ? bandXs.at(-1)! - LANE_GAP : 0;
  const height =
    MARGIN +
    Math.max(
      0,
      ...stickies.map((s) => s.y + s.h),
      ...[...arrows, ...links, ...cancels].flat().map(([, y]) => y),
    );

  return {
    width,
    height,
    stickies,
    arrows,
    links,
    cancels,
    lanes: lanes.flatMap((l, i) =>
      l.name === null ? [] : [{ name: l.name, line: l.line!, x: bandXs[i]!, y: 0, w: bandWs[i]!, h: height }],
    ),
    gaps: bandWs.slice(0, -1).map((w, i) => ({ x: bandXs[i]! + w, y: 0, w: LANE_GAP, h: height })),
  };
}
