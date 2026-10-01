/**
 * A language server for .estorm files, for editors such as Neovim, Rider and
 * VS Code. Speaks the Language Server Protocol over stdio and provides:
 *
 *   semantic tokens     colours, named after the sticky each token becomes
 *   diagnostics         parse errors, on the offending line
 *   document highlight  every mention of the event under the cursor
 *
 * Only the small part of the protocol these need is implemented, so the
 * server has no dependencies. Documents are synced in full on each change.
 */
import { parse, ParseError } from './parser.ts';
import { tokenize, type Token, type TokenKind } from './highlight.ts';

/**
 * Semantic token types, in legend order. Sticky kinds keep their names
 * (camelCased, as editors use them in highlight group names); the rest use
 * standard types so themes colour them without configuration.
 */
export const TOKEN_TYPES = [
  'comment',
  'keyword',
  'operator',
  'section',
  'actor',
  'command',
  'aggregate',
  'external',
  'event',
  'readModel',
  'schedule',
  'hotspot',
] as const;

const TYPE_OF: Record<TokenKind, (typeof TOKEN_TYPES)[number]> = {
  comment: 'comment',
  keyword: 'keyword',
  arrow: 'operator',
  punct: 'operator',
  section: 'section',
  actor: 'actor',
  command: 'command',
  policy: 'keyword',
  aggregate: 'aggregate',
  external: 'external',
  event: 'event',
  'read-model': 'readModel',
  schedule: 'schedule',
  hotspot: 'hotspot',
};

interface Message {
  id?: number | string | null;
  method?: string;
  params?: any;
}

interface Position {
  line: number;
  character: number;
}

const lines = (text: string) => text.split(/\r?\n/);

/** The LSP semantic tokens encoding: five relative integers per token. */
export function semanticTokens(text: string): number[] {
  const data: number[] = [];
  let prevLine = 0;
  let prevStart = 0;
  lines(text).forEach((line, n) => {
    for (const t of tokenize(line)) {
      const deltaLine = n - prevLine;
      const deltaStart = deltaLine === 0 ? t.from - prevStart : t.from;
      data.push(deltaLine, deltaStart, t.to - t.from, TOKEN_TYPES.indexOf(TYPE_OF[t.kind]), 0);
      prevLine = n;
      prevStart = t.from;
    }
  });
  return data;
}

/** The parse error in TEXT as an LSP diagnostic covering its line, if any. */
export function diagnostics(text: string) {
  try {
    parse(text);
    return [];
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    const line = e.line - 1;
    const content = lines(text)[line] ?? '';
    const start = content.length - content.trimStart().length;
    return [
      {
        range: { start: { line, character: start }, end: { line, character: content.length } },
        severity: 1,
        source: 'estorm',
        message: e.message,
      },
    ];
  }
}

/** Every mention of the event under POS, or [] when it isn't on one. */
export function eventHighlights(text: string, pos: Position) {
  const all = lines(text);
  const name = (line: string, t: Token) => line.slice(t.from, t.to);
  const line = all[pos.line] ?? '';
  const at = tokenize(line).find((t) => t.kind === 'event' && t.from <= pos.character && pos.character <= t.to);
  if (!at) return [];
  const current = name(line, at);
  return all.flatMap((line, n) =>
    tokenize(line)
      .filter((t) => t.kind === 'event' && name(line, t) === current)
      .map((t) => ({ range: { start: { line: n, character: t.from }, end: { line: n, character: t.to } } })),
  );
}

/**
 * The protocol, independent of transport: feed it each incoming message and
 * it sends replies and notifications through SEND. Calls EXIT on 'exit'.
 */
export function createServer(send: (msg: object) => void, exit: (code: number) => void) {
  const docs = new Map<string, string>();
  let shutdown = false;

  const publish = (uri: string, text: string) =>
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: diagnostics(text) },
    });

  const requests: Record<string, (params: any) => unknown> = {
    initialize: () => ({
      capabilities: {
        textDocumentSync: { openClose: true, change: 1 },
        semanticTokensProvider: { legend: { tokenTypes: TOKEN_TYPES, tokenModifiers: [] }, full: true },
        documentHighlightProvider: true,
      },
      serverInfo: { name: 'estorm' },
    }),
    shutdown: () => {
      shutdown = true;
      return null;
    },
    'textDocument/semanticTokens/full': (p) => ({ data: semanticTokens(docs.get(p.textDocument.uri) ?? '') }),
    'textDocument/documentHighlight': (p) => eventHighlights(docs.get(p.textDocument.uri) ?? '', p.position),
  };

  const notifications: Record<string, (params: any) => void> = {
    'textDocument/didOpen': (p) => {
      docs.set(p.textDocument.uri, p.textDocument.text);
      publish(p.textDocument.uri, p.textDocument.text);
    },
    'textDocument/didChange': (p) => {
      const text = p.contentChanges.at(-1)?.text;
      if (typeof text !== 'string') return;
      docs.set(p.textDocument.uri, text);
      publish(p.textDocument.uri, text);
    },
    'textDocument/didClose': (p) => {
      docs.delete(p.textDocument.uri);
      publish(p.textDocument.uri, '');
    },
    exit: () => exit(shutdown ? 0 : 1),
  };

  return (msg: Message) => {
    const { id, method = '' } = msg;
    if (id === undefined) {
      notifications[method]?.(msg.params);
      return;
    }
    const handler = requests[method];
    if (!handler) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported method: ${method}` } });
      return;
    }
    try {
      send({ jsonrpc: '2.0', id, result: handler(msg.params) });
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
  };
}

/** Runs the server over stdin/stdout, with LSP's Content-Length framing. */
export function serveStdio(): void {
  const send = (msg: object) => {
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
  };
  const handle = createServer(send, (code) => process.exit(code));

  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1]);
      if (!Number.isInteger(length)) {
        buffer = buffer.subarray(end + 4);
        continue;
      }
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      buffer = buffer.subarray(end + 4 + length);
      let msg: Message;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(1));
}
