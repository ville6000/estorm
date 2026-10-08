/**
 * Lints a board for modelling smells the parser accepts: events not named
 * in the past tense, and aggregates shared by several bounded contexts.
 */
import type { Board, Step, Via } from './parser.ts';

export interface Warning {
  line: number;
  message: string;
}

/** Past participles that don't end in "ed". */
const IRREGULAR = new Set(
  (
    'been begun bent bid bitten bought brought built burnt cast caught chosen come cost cut dealt done drawn ' +
    'driven eaten fallen fed felt fought found fled forbidden forgiven forgotten frozen given gone got gotten ' +
    'grown heard held hidden hit hung hurt kept known laid led left lent let lit lost made meant met paid put ' +
    'quit read rung risen run said seen sent set shot shown shut sold sought spent split spoken spread stolen ' +
    'struck stuck sung sunk swept swung taken taught thought thrown told torn understood withdrawn won worn ' +
    'written'
  ).split(' '),
);

const PREFIX = /^(re|pre|un|over|under|mis)(?=.)/;

/**
 * Whether NAME ("OrderPlaced", "Order placed", "RoomMarkedDirty") reads as
 * past tense: some word of it is a past participle. A heuristic that
 * prefers missing a bad name to flagging a good one.
 */
export function isPastTense(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((w) => w.endsWith('ed') || IRREGULAR.has(w) || IRREGULAR.has(w.replace(PREFIX, '')));
}

/** Warnings for BOARD, ordered by line. */
export function lint(board: Board): Warning[] {
  const warnings: Warning[] = [];
  const events = new Set<string>();
  /** Each aggregate, with the line of its first use in each section. */
  const aggregates = new Map<string, Map<string, number>>();
  let section: string | undefined;

  const event = (name: string, line: number) => {
    if (events.has(name)) return;
    events.add(name);
    if (!isPastTense(name)) warnings.push({ line, message: `event should be in the past tense: ${name}` });
  };
  const via = (list: Via[], line: number) => {
    if (section === undefined) return;
    for (const v of list) {
      if (v.type !== 'aggregate') continue;
      if (!aggregates.has(v.name)) aggregates.set(v.name, new Map());
      const sections = aggregates.get(v.name)!;
      if (!sections.has(section)) sections.set(section, line);
    }
  };
  const steps = (list: Step[]) => {
    for (const s of list) {
      if (s.type === 'reaction') {
        for (const e of s.events) event(e, s.line);
        via(s.via, s.line);
      }
      steps(s.reactions);
    }
  };

  for (const item of board) {
    switch (item.type) {
      case 'section':
        section = item.name;
        break;
      case 'event':
        event(item.name, item.line);
        steps(item.reactions);
        break;
      case 'when':
        steps(item.reactions);
        break;
      case 'flow':
        for (const e of item.events) event(e, item.line);
        via(item.via, item.line);
        steps(item.reactions);
        break;
    }
  }

  for (const [name, sections] of aggregates) {
    if (sections.size < 2) continue;
    warnings.push({
      line: [...sections.values()][1]!,
      message: `aggregate ${name} is used in several contexts: ${[...sections.keys()].join(', ')}`,
    });
  }
  return warnings.sort((a, b) => a.line - b.line);
}
