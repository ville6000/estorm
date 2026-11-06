import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  completions,
  createServer,
  diagnostics,
  eventDefinitions,
  eventHighlights,
  prepareRename,
  rename,
  semanticTokens,
  TOKEN_TYPES,
} from '../src/lsp.ts';

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

/** TEXT with EDITS applied, as an editor would. */
function apply(text: string, edits: { range: ReturnType<typeof range>; newText: string }[]): string {
  const lines = text.split('\n');
  const last = [...edits].sort(
    (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character,
  );
  for (const { range: r, newText } of last) {
    const l = lines[r.start.line]!;
    lines[r.start.line] = l.slice(0, r.start.character) + newText + l.slice(r.end.character);
  }
  return lines.join('\n');
}

/** Decodes semantic tokens back to [line, text, type] for readable expectations. */
function decode(text: string): [number, string, string][] {
  const data = semanticTokens(text);
  const lines = text.split('\n');
  const out: [number, string, string][] = [];
  let line = 0;
  let start = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [dl, ds, len, type] = data.slice(i, i + 4) as [number, number, number, number];
    line += dl;
    start = dl === 0 ? start + ds : ds;
    out.push([line, lines[line]!.slice(start, start + len), TOKEN_TYPES[type]!]);
  }
  return out;
}

describe('semanticTokens', () => {
  it('encodes tokens relative to the previous one, across lines', () => {
    expect(decode('# Orders\nCustomer: Place -> (Order) -> Placed\n  then Ship -> Shipped')).toEqual([
      [0, '# Orders', 'comment'],
      [1, 'Customer', 'actor'],
      [1, ':', 'operator'],
      [1, 'Place', 'command'],
      [1, '->', 'operator'],
      [1, '(Order)', 'aggregate'],
      [1, '->', 'operator'],
      [1, 'Placed', 'event'],
      [2, 'then', 'keyword'],
      [2, 'Ship', 'command'],
      [2, '->', 'operator'],
      [2, 'Shipped', 'event'],
    ]);
  });

  it('names read models in camelCase', () => {
    expect(decode('{Order list}')).toEqual([[0, '{Order list}', 'readModel']]);
  });

  it('marks rules', () => {
    expect(decode('  * Never overbooked')).toEqual([[0, '* Never overbooked', 'rule']]);
  });

  it('handles CRLF line endings', () => {
    expect(decode('A: Do -> Done\r\n# note').map(([l, , type]) => [l, type])).toEqual([
      [0, 'actor'],
      [0, 'operator'],
      [0, 'command'],
      [0, 'operator'],
      [0, 'event'],
      [1, 'comment'],
    ]);
  });
});

describe('diagnostics', () => {
  it('is empty for a valid board', () => {
    expect(diagnostics('A: Do -> Done')).toEqual([]);
  });

  it('reports a parse error on its line, without indentation', () => {
    expect(diagnostics('A: Do -> Done\n  then Oops')).toEqual([
      {
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 11 } },
        severity: 1,
        source: 'estorm',
        message: 'chain must end with an event',
      },
    ]);
  });

  it('reports every parse error, and lint warnings for the lines that parse', () => {
    const text = ['A: Do -> Done', '  then Oops', 'B: Go -> Going', 'C: ->', 'when Nope', '  then Send -> Sent'].join(
      '\n',
    );
    expect(diagnostics(text).map((d) => [d.range.start.line, d.severity, d.message])).toEqual([
      [1, 1, 'chain must end with an event'],
      [3, 1, 'empty item in chain'],
      [4, 1, "'when' refers to unknown event Nope"],
      [2, 2, 'event should be in the past tense: Going'],
    ]);
  });

  it('reports lint warnings with warning severity', () => {
    expect(diagnostics('A: Do -> Doing')).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
        severity: 2,
        source: 'estorm',
        message: 'event should be in the past tense: Doing',
      },
    ]);
  });
});

describe('eventHighlights', () => {
  const text = 'A: Do -> Done\nwhen Done\n  then Next -> Later';

  it('finds every mention of the event under the cursor', () => {
    expect(eventHighlights(text, { line: 1, character: 6 })).toEqual([
      { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 13 } } },
      { range: { start: { line: 1, character: 5 }, end: { line: 1, character: 9 } } },
    ]);
  });

  it('is empty off an event', () => {
    expect(eventHighlights(text, { line: 0, character: 3 })).toEqual([]);
  });
});

describe('eventDefinitions', () => {
  const text = [
    'A: Do -> Done',
    'when Done',
    '  then Next -> Later',
    '    after 1 day unless Done',
    '      then Close -> Closed',
    'Done',
  ].join('\n');
  const producers = [range(0, 9, 13), range(5, 0, 4)];

  it("goes from 'when' and 'unless' to each chain and line that produces the event", () => {
    expect(eventDefinitions(text, { line: 1, character: 6 })).toEqual(producers);
    expect(eventDefinitions(text, { line: 3, character: 25 })).toEqual(producers);
  });

  it('goes from a producer to all of them', () => {
    expect(eventDefinitions(text, { line: 5, character: 2 })).toEqual(producers);
  });

  it('is empty off an event, and for an event nothing produces', () => {
    expect(eventDefinitions(text, { line: 0, character: 3 })).toEqual([]);
    expect(eventDefinitions('when Nope\n  then Do -> Done', { line: 0, character: 6 })).toEqual([]);
  });
});

describe('prepareRename', () => {
  it('offers events and actors, and aggregates and externals without their brackets', () => {
    const text = 'Customer: Do -> (Order) -> [CRM] -> Done';
    expect(prepareRename(text, { line: 0, character: 3 })).toEqual({ range: range(0, 0, 8), placeholder: 'Customer' });
    expect(prepareRename(text, { line: 0, character: 19 })).toEqual({ range: range(0, 17, 22), placeholder: 'Order' });
    expect(prepareRename(text, { line: 0, character: 29 })).toEqual({ range: range(0, 28, 31), placeholder: 'CRM' });
    expect(prepareRename(text, { line: 0, character: 38 })).toEqual({ range: range(0, 36, 40), placeholder: 'Done' });
  });

  it('is null for commands, brackets, keywords and comments', () => {
    const text = 'A: Do -> (Order) -> Done\nwhen Done\n  then Go -> Gone\n# Done';
    expect(prepareRename(text, { line: 0, character: 4 })).toBeNull();
    expect(prepareRename(text, { line: 0, character: 9 })).toBeNull();
    expect(prepareRename(text, { line: 1, character: 2 })).toBeNull();
    expect(prepareRename(text, { line: 3, character: 4 })).toBeNull();
  });
});

describe('rename', () => {
  const board = [
    'Customer: Place -> (Order) -> Placed',
    '  then Charge -> [Order] -> Charged',
    '  ! Is Placed enough?',
    'when Placed, Charged',
    '  after 1 day unless Placed',
    '    then Remind -> Reminded',
    'Customer: Pack -> (Order) -> Packed',
    'Placed',
  ].join('\n');
  const renamed = (line: number, character: number, to: string) =>
    apply(board, rename(board, { line, character }, to)!);

  it("renames an event in chains, 'when', 'unless' and on its own line, but not in free text", () => {
    expect(renamed(3, 7, 'OrderPlaced')).toBe(board.replace(/(?<!Is )\bPlaced\b/g, 'OrderPlaced'));
  });

  it('renames an aggregate apart from an external of the same name', () => {
    expect(renamed(0, 22, 'Basket')).toBe(board.replaceAll('(Order)', '(Basket)'));
  });

  it('renames an actor, trimming the new name', () => {
    expect(renamed(0, 3, '  Shopper ')).toBe(board.replaceAll('Customer:', 'Shopper:'));
  });

  it('is null off a name', () => {
    expect(rename(board, { line: 0, character: 12 }, 'Buy')).toBeNull();
  });

  it('keeps errors the board already has, and merges into a name already on it', () => {
    const text = 'A: Do -> Done\nB: Go -> Finished\nwhen Nope\n  then X -> Y';
    expect(apply(text, rename(text, { line: 0, character: 10 }, 'Finished')!)).toBe(text.replace('Done', 'Finished'));
  });

  it('refuses names that are empty or contain arrows, brackets, braces or colons', () => {
    for (const to of ['  ', 'A -> B', '(Order)', '[CRM]', '{List}', 'At: 9']) {
      expect(() => rename(board, { line: 0, character: 32 }, to)).toThrow(/^A name cannot/);
    }
  });

  it('refuses a name that would change what a line means', () => {
    expect(() => rename(board, { line: 1, character: 30 }, 'Charged, Paid')).toThrow(
      'Renaming to Charged, Paid would change what line 2 means',
    );
    expect(() => rename(board, { line: 7, character: 2 }, '# Placed')).toThrow(
      'Renaming to # Placed would change what line 8 means',
    );
  });

  it('refuses a name that would break a line', () => {
    expect(() => rename('A: Do -> Done, Undone', { line: 0, character: 10 }, 'Undone')).toThrow(
      'Renaming to Undone would break line 1: chain names Undone twice',
    );
  });
});

describe('completions', () => {
  const board = 'Customer: Place order -> (Order) -> Order placed\n  then Charge -> [Stripe] -> Card charged\n';
  /** Completes at the end of LINE, appended to the board; returns [label, newText, range start]. */
  const at = (line: string, after = '') =>
    completions(board + line + after, { line: 2, character: line.length }).map((c) => [
      c.label,
      c.textEdit.newText,
      c.textEdit.range.start.character,
    ]);

  it('offers events after when, unless and arrows, replacing the whole name', () => {
    const events = [
      ['Order placed', 'Order placed', 5],
      ['Card charged', 'Card charged', 5],
    ];
    expect(at('when Order p')).toEqual(events);
    expect(at('  after 1 day unless ').map(([l]) => l)).toEqual(['Order placed', 'Card charged']);
    expect(at('  then Refund -> ').map(([l]) => l)).toEqual(['Order placed', 'Card charged']);
  });

  it('offers aggregates and externals in their brackets, eating an auto-closed bracket', () => {
    expect(at('A: Do -> (Or')).toEqual([['Order', '(Order)', 9]]);
    expect(at('A: Do -> [', ']')).toEqual([['Stripe', '[Stripe]', 9]]);
    const [item] = completions(board + 'A: Do -> (O)', { line: 2, character: 11 });
    expect(item!.textEdit.range.end.character).toBe(12);
  });

  it('offers keywords, actors and events at the start of a line', () => {
    expect(at('  ').map(([, t]) => t)).toEqual([
      'when ',
      'then ',
      'after ',
      'every ',
      'Customer: ',
      'Order placed',
      'Card charged',
    ]);
  });

  it('offers nothing for commands, schedules or comments', () => {
    expect(at('  then ')).toEqual([]);
    expect(at('Customer: ')).toEqual([]);
    expect(at('every ')).toEqual([]);
    expect(at('# Or')).toEqual([]);
  });

  it('does not offer the name being typed', () => {
    expect(completions('when Ord', { line: 0, character: 8 })).toEqual([]);
  });
});

describe('createServer', () => {
  const start = () => {
    const sent: any[] = [];
    let exitCode: number | undefined;
    const handle = createServer(
      (m) => sent.push(m),
      (c) => (exitCode = c),
    );
    return { sent, handle, exitCode: () => exitCode };
  };
  const uri = 'file:///board.estorm';

  it('advertises its capabilities on initialize', () => {
    const { sent, handle } = start();
    handle({ id: 1, method: 'initialize', params: {} });
    expect(sent[0].id).toBe(1);
    expect(sent[0].result.capabilities.semanticTokensProvider.legend.tokenTypes).toEqual(TOKEN_TYPES);
  });

  it('publishes diagnostics on open and change, and clears them on close', () => {
    const { sent, handle } = start();
    handle({ method: 'textDocument/didOpen', params: { textDocument: { uri, text: 'A: Do -> Done' } } });
    handle({
      method: 'textDocument/didChange',
      params: { textDocument: { uri }, contentChanges: [{ text: 'A: Do -> (Oops)' }] },
    });
    handle({ method: 'textDocument/didClose', params: { textDocument: { uri } } });
    expect(sent.map((m) => m.params.diagnostics.length)).toEqual([0, 1, 0]);
  });

  it('serves semantic tokens for the latest text', () => {
    const { sent, handle } = start();
    handle({ method: 'textDocument/didOpen', params: { textDocument: { uri, text: '# x' } } });
    handle({ id: 2, method: 'textDocument/semanticTokens/full', params: { textDocument: { uri } } });
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, result: { data: [0, 0, 3, 0, 0] } });
  });

  it('offers prepareRename only to clients that support it', () => {
    const { sent, handle } = start();
    handle({ id: 1, method: 'initialize', params: {} });
    handle({
      id: 2,
      method: 'initialize',
      params: { capabilities: { textDocument: { rename: { prepareSupport: true } } } },
    });
    expect(sent.map((m) => m.result.capabilities.renameProvider)).toEqual([true, { prepareProvider: true }]);
  });

  it('answers definition with locations, and rename with a workspace edit', () => {
    const { sent, handle } = start();
    const text = 'A: Do -> Done\nwhen Done\n  then Go -> Gone';
    handle({ method: 'textDocument/didOpen', params: { textDocument: { uri, text } } });
    const at = { textDocument: { uri }, position: { line: 1, character: 6 } };
    handle({ id: 2, method: 'textDocument/definition', params: at });
    handle({ id: 3, method: 'textDocument/rename', params: { ...at, newName: 'Finished' } });
    expect(sent.slice(-2).map((m) => m.result)).toEqual([
      [{ uri, range: range(0, 9, 13) }],
      { changes: { [uri]: [range(0, 9, 13), range(1, 5, 9)].map((r) => ({ range: r, newText: 'Finished' })) } },
    ]);
  });

  it('reports a rename it refuses as a failed request, for the user to read', () => {
    const { sent, handle } = start();
    handle({ method: 'textDocument/didOpen', params: { textDocument: { uri, text: 'A: Do -> Done' } } });
    handle({
      id: 2,
      method: 'textDocument/rename',
      params: { textDocument: { uri }, position: { line: 0, character: 10 }, newName: '' },
    });
    expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32803, message: 'A name cannot be empty' } });
  });

  it('rejects unknown requests and ignores unknown notifications', () => {
    const { sent, handle } = start();
    handle({ method: 'workspace/didChangeConfiguration', params: {} });
    handle({ id: 3, method: 'textDocument/hover', params: {} });
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'unsupported method: textDocument/hover' } },
    ]);
  });

  it('exits with 0 after shutdown, 1 without', () => {
    const a = start();
    a.handle({ id: 4, method: 'shutdown' });
    a.handle({ method: 'exit' });
    expect(a.exitCode()).toBe(0);
    const b = start();
    b.handle({ method: 'exit' });
    expect(b.exitCode()).toBe(1);
  });
});

describe('estorm lsp', () => {
  it('speaks LSP over stdio', async () => {
    const child = spawn('node', ['src/cli.ts', 'lsp', '--stdio']);
    const frame = (msg: object) => {
      const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
      return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    };
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    // Split across writes, with a multi-byte character, to exercise framing.
    const open = { textDocument: { uri: 'file:///b.estorm', text: '! Who owns → this?' } };
    const bytes = Buffer.from(
      frame({ id: 1, method: 'initialize', params: {} }) +
        frame({ method: 'textDocument/didOpen', params: open }) +
        frame({ id: 2, method: 'shutdown' }) +
        frame({ method: 'exit' }),
    );
    child.stdin.write(bytes.subarray(0, 30));
    child.stdin.write(bytes.subarray(30));
    expect(await exited).toBe(0);
    const bodies = out
      .split(/Content-Length: \d+\r\n\r\n/)
      .filter(Boolean)
      .map((b) => JSON.parse(b));
    expect(bodies.map((b) => b.id ?? b.method)).toEqual([1, 'textDocument/publishDiagnostics', 2]);
  });
});
