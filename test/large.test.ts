import { describe, expect, it } from 'vitest';
import { layout, lint, parse, parseAll, summarize, svg, timeline } from '../src/index.ts';
import { diagnostics } from '../src/lsp.ts';

/**
 * A board of SECTIONS lanes with FLOWS flows each, using every statement:
 * read models, rules, reactions, hotspots, afters and whens across lanes.
 */
function bigBoard(sections: number, flows: number): string {
  const out: string[] = [];
  for (let s = 0; s < sections; s++) {
    out.push(`== Context ${s} ==`);
    for (let f = 0; f < flows; f++) {
      const id = `${s}x${f}`;
      out.push(
        `{View ${id}}`,
        `User ${f % 7}: Do thing ${id} -> (Agg ${s}) -> [Ext ${f % 3}] -> Thing${id}Done`,
        `  * Rule ${id}`,
        `  then React ${id} -> (Agg ${s}) -> Reacted${id}`,
        `    ! Question ${id}?`,
        `  after 3 days unless Reacted${id}`,
        `    then Expire ${id} -> Expired${id}`,
      );
      if (s > 0) out.push(`when Thing${s - 1}x${f}Done`, `  then Follow ${id} -> Followed${id}`);
      out.push('');
    }
  }
  return out.join('\n');
}

/** Milliseconds F takes. */
function time(f: () => unknown): number {
  const start = performance.now();
  f();
  return performance.now() - start;
}

// Budgets are generous, to catch quadratic slowdowns (minutes at this size)
// without failing on a slow machine.
describe('a board of about 100,000 lines', () => {
  const text = bigBoard(10, 1000);

  it('goes through every step in seconds', () => {
    expect(text.split('\n').length).toBeGreaterThan(95_000);
    const ms = time(() => {
      const board = parse(text);
      const l = layout(board);
      expect(l.stickies.length).toBeGreaterThan(100_000);
      svg(l);
      svg(timeline(board));
      lint(board);
      summarize(board);
    });
    expect(ms).toBeLessThan(15_000);
  });

  it('reports thousands of errors at once in seconds', () => {
    // Break every flow: each is reported, and nothing under it.
    const broken = text.replace(/^(User \d+: Do thing \S+) -> /gm, '$1 -> -> ');
    let errors = 0;
    const ms = time(() => {
      errors = parseAll(broken).errors.length;
      diagnostics(broken);
    });
    expect(errors).toBe(10_000);
    expect(ms).toBeLessThan(15_000);
  });
});

describe('a big board', () => {
  const l = layout(parse(bigBoard(4, 40)));

  it('has no overlapping stickies', () => {
    const byY = [...l.stickies].sort((a, b) => a.y - b.y);
    const overlaps = byY.flatMap((a, i) =>
      byY
        .slice(i + 1)
        .filter((b) => b.y < a.y + a.h && a.x < b.x + b.w && b.x < a.x + a.w)
        .map((b) => [a.text, b.text]),
    );
    expect(overlaps).toEqual([]);
  });

  it('has no links through stickies', () => {
    const crossed = [...l.links, ...l.cancels].flatMap((path) =>
      path.slice(1).flatMap(([bx, by], i) => {
        const [ax, ay] = path[i]!;
        return l.stickies
          .filter(
            (s) =>
              Math.max(ax, bx) > s.x + 1 &&
              Math.min(ax, bx) < s.x + s.w - 1 &&
              Math.max(ay, by) > s.y + 1 &&
              Math.min(ay, by) < s.y + s.h - 1,
          )
          .map((s) => s.text);
      }),
    );
    expect(crossed).toEqual([]);
  });
});

describe('long lines', () => {
  it.each([
    ['a section', `== ${' '.repeat(50_000)}x`],
    ['an after', `A: Do -> Done\n  after ${'a '.repeat(50_000)}`],
    ['a schedule', `every ${'a '.repeat(50_000)}: Do -> Done`],
    ['a chain', `A: Do${' -> (X)'.repeat(20_000)} -> Done`],
  ])('parses %s in well under a second', (_, line) => {
    expect(time(() => parseAll(line))).toBeLessThan(1000);
  });

  it('lays out 100,000 events on one row', () => {
    const events = Array.from({ length: 100_000 }, (_, i) => `Event${i}Happened`).join('\n');
    const l = layout(parse(events));
    expect(l.stickies).toHaveLength(100_000);
    expect(new Set(l.stickies.map((s) => s.y)).size).toBe(1);
    expect(() => svg(l)).not.toThrow();
  });
});
