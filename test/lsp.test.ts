import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createServer, diagnostics, eventHighlights, semanticTokens, TOKEN_TYPES } from '../src/lsp.ts';

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
