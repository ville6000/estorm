/**
 * A language server for .estorm files, for any editor with an LSP client.
 * Speaks the Language Server Protocol over stdio and provides:
 *
 *   semantic tokens     colours, named after the sticky each token becomes
 *   diagnostics         parse errors and lint warnings, on the offending line
 *   document highlight  every mention of the event under the cursor
 *   completion          keywords, and events, aggregates, externals and actors
 *                       already on the board
 *   definition          from an event to the steps that produce it
 *   rename              an event, aggregate, external or actor, everywhere
 *
 * Only the small part of the protocol these need is implemented, so the
 * server has no dependencies. Documents are synced in full on each change.
 */
import { parseAll } from './parser.ts';
import { lint } from './lint.ts';
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
  'rule',
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
  rule: 'rule',
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

const ERROR = 1;
const WARNING = 2;

/** The parse errors in TEXT and the lint warnings for what parsed, as LSP diagnostics covering their lines. */
export function diagnostics(text: string) {
  const all = lines(text);
  const diagnostic = (n: number, severity: number, message: string) => {
    const line = n - 1;
    const content = all[line] ?? '';
    const start = content.length - content.trimStart().length;
    return {
      range: { start: { line, character: start }, end: { line, character: content.length } },
      severity,
      source: 'estorm',
      message,
    };
  };
  const { board, errors } = parseAll(text);
  return [
    ...errors.map((e) => diagnostic(e.line, ERROR, e.message)),
    ...lint(board).map((w) => diagnostic(w.line, WARNING, w.message)),
  ];
}

/** The kinds of name a board repeats, and so can rename or look up. */
type NameKind = 'event' | 'aggregate' | 'external' | 'actor';

/** One mention of a name: an aggregate's or external's without its brackets. */
interface Mention {
  kind: NameKind;
  name: string;
  line: number;
  from: number;
  to: number;
  /** Whether the step on this line produces the event, rather than a `when` or `unless` naming it. */
  produces: boolean;
}

const BRACKETED = { aggregate: /^\([^()[\]]+\)$/, external: /^\[[^()[\]]+\]$/ };

/** The names mentioned on LINE, line number N, in order. */
function mentionsIn(line: string, n: number): Mention[] {
  const tokens = tokenize(line);
  const keyword = (t: Token | undefined, word: string) => t?.kind === 'keyword' && line.slice(t.from, t.to) === word;
  return tokens.flatMap((t, i): Mention[] => {
    let { from, to } = t;
    if (t.kind === 'aggregate' || t.kind === 'external') {
      if (!BRACKETED[t.kind].test(line.slice(from, to))) return [];
      from++;
      to--;
      while (line[from] === ' ') from++;
      while (line[to - 1] === ' ') to--;
      if (from >= to) return [];
    } else if (t.kind !== 'event' && t.kind !== 'actor') {
      return [];
    }
    const named = t.kind === 'event' && (keyword(tokens[0], 'when') || keyword(tokens[i - 1], 'unless'));
    return [{ kind: t.kind, name: line.slice(from, to), line: n, from, to, produces: !named }];
  });
}

const allMentions = (all: string[]) => all.flatMap(mentionsIn);

const mentionAt = (all: string[], pos: Position) =>
  mentionsIn(all[pos.line] ?? '', pos.line).find((m) => m.from <= pos.character && pos.character <= m.to);

const sameName = (a: Mention) => (b: Mention) => a.kind === b.kind && a.name === b.name;

const rangeOf = (m: Mention) => ({
  start: { line: m.line, character: m.from },
  end: { line: m.line, character: m.to },
});

/** Every mention of the event under POS, or [] when it isn't on one. */
export function eventHighlights(text: string, pos: Position) {
  const all = lines(text);
  const at = mentionAt(all, pos);
  if (at?.kind !== 'event') return [];
  return allMentions(all)
    .filter(sameName(at))
    .map((m) => ({ range: rangeOf(m) }));
}

/**
 * Where the event under POS is produced: the end of each chain that has it,
 * and each line that has it on its own. [] when POS isn't on an event, or
 * nothing produces it.
 */
export function eventDefinitions(text: string, pos: Position) {
  const all = lines(text);
  const at = mentionAt(all, pos);
  if (at?.kind !== 'event') return [];
  return allMentions(all)
    .filter((m) => m.produces && sameName(at)(m))
    .map(rangeOf);
}

/** A request that can't be carried out, with a message for the user. */
export class RequestFailed extends Error {}

/** The name under POS to rename, as LSP's prepareRename result, or null when POS isn't on one. */
export function prepareRename(text: string, pos: Position) {
  const at = mentionAt(lines(text), pos);
  return at ? { range: rangeOf(at), placeholder: at.name } : null;
}

/**
 * Text edits that rename the event, aggregate, external or actor under POS
 * to NEWNAME, everywhere it is mentioned; null when POS isn't on one.
 * Aggregates and externals keep their brackets, and an aggregate is renamed
 * apart from an external of the same name. Throws RequestFailed when
 * NEWNAME isn't a valid name there, or would break or change a line.
 */
export function rename(text: string, pos: Position, newName: string) {
  const all = lines(text);
  const at = mentionAt(all, pos);
  if (!at) return null;
  const name = newName.trim();
  if (!name) throw new RequestFailed('A name cannot be empty');
  if (/->|[()[\]{}:\r\n]/.test(name)) throw new RequestFailed('A name cannot contain ->, brackets, braces or a colon');

  const renamed = allMentions(all).filter(sameName(at));
  /** What LINE says, as its token kinds and its names, the ones being renamed read as NAMED. */
  const shape = (line: string, named: (m: Mention) => string) =>
    JSON.stringify([tokenize(line).map((t) => t.kind), mentionsIn(line, 0).map((m) => [m.kind, named(m)])]);
  const after = [...all];
  for (const n of new Set(renamed.map((m) => m.line))) {
    const before = all[n]!;
    let line = '';
    let end = 0;
    for (const m of renamed.filter((m) => m.line === n)) {
      line += before.slice(end, m.from) + name;
      end = m.to;
    }
    after[n] = line += before.slice(end);
    // Only the name may change: one like `# Note` turns an event's line into a comment, `A, B` into two events.
    if (shape(line, (m) => m.name) !== shape(before, (m) => (sameName(at)(m) ? name : m.name)))
      throw new RequestFailed(`Renaming to ${name} would change what line ${n + 1} means`);
  }

  const known = parseAll(all.join('\n')).errors.map((e) => `${e.line}:${e.code}`);
  for (const e of parseAll(after.join('\n')).errors) {
    const i = known.indexOf(`${e.line}:${e.code}`);
    if (i === -1) throw new RequestFailed(`Renaming to ${name} would break line ${e.line}: ${e.message}`);
    known.splice(i, 1);
  }

  return renamed.map((m) => ({ range: rangeOf(m), newText: name }));
}

const KEYWORDS = ['when', 'then', 'after', 'every'];

/** LSP CompletionItemKind for each kind of name offered. */
const ITEM_KIND: Record<NameKind | 'keyword', number> = { keyword: 14, event: 23, aggregate: 7, external: 9, actor: 6 };

/**
 * Completions at POS: events after `when`, `unless` or an arrow, aggregates
 * after `(`, externals after `[`, and keywords, actors and events at the
 * start of a line. Names come from the rest of the document. Commands are
 * not completed: each is written once.
 */
export function completions(text: string, pos: Position) {
  const all = lines(text);
  const line = all[pos.line] ?? '';
  const prefix = line.slice(0, pos.character);
  // A placeholder makes the tokenizer see the name being typed, even when it is still empty.
  const tokens = tokenize(prefix + 'x');
  const at = tokens.find((t) => t.to === prefix.length + 1);
  if (!at) return [];
  const atLineStart = at === tokens[0] && at.from === line.length - line.trimStart().length;

  const names: Record<NameKind, Set<string>> = {
    event: new Set(),
    aggregate: new Set(),
    external: new Set(),
    actor: new Set(),
  };
  all.forEach((l, n) => {
    for (const t of tokenize(l)) {
      if (n === pos.line && t.from <= pos.character && pos.character <= t.to) continue;
      const word = l.slice(t.from, t.to);
      if (t.kind === 'event' || t.kind === 'actor') names[t.kind].add(word);
      else if ((t.kind === 'aggregate' || t.kind === 'external') && /^\(.+\)$|^\[.+\]$/.test(word))
        names[t.kind].add(word.slice(1, -1).trim());
    }
  });

  // Replace the whole name typed so far, spaces included, and a closing bracket the editor added.
  const closer = { aggregate: ')', external: ']' }[at.kind as string];
  const end = closer && line[pos.character] === closer ? pos.character + 1 : pos.character;
  const range = { start: { line: pos.line, character: at.from }, end: { line: pos.line, character: end } };
  const item = (kind: keyof typeof ITEM_KIND, label: string, newText: string) => ({
    label,
    kind: ITEM_KIND[kind],
    detail: kind,
    filterText: newText,
    textEdit: { range, newText },
  });
  const list = (kind: NameKind, insert: (name: string) => string) =>
    [...names[kind]].map((n) => item(kind, n, insert(n)));

  switch (at.kind) {
    case 'aggregate':
      return list('aggregate', (n) => `(${n})`);
    case 'external':
      return list('external', (n) => `[${n}]`);
    case 'event':
      if (!atLineStart) return list('event', (n) => n);
      return [
        ...KEYWORDS.map((k) => item('keyword', k, k + ' ')),
        ...list('actor', (n) => n + ': '),
        ...list('event', (n) => n),
      ];
    default:
      return [];
  }
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

  const textOf = (p: any) => docs.get(p.textDocument.uri) ?? '';

  const requests: Record<string, (params: any) => unknown> = {
    initialize: (p) => ({
      capabilities: {
        textDocumentSync: { openClose: true, change: 1 },
        semanticTokensProvider: { legend: { tokenTypes: TOKEN_TYPES, tokenModifiers: [] }, full: true },
        documentHighlightProvider: true,
        completionProvider: { triggerCharacters: [' ', '(', '['] },
        definitionProvider: true,
        // Servers may only offer prepareRename to clients that say they support it.
        renameProvider: p?.capabilities?.textDocument?.rename?.prepareSupport ? { prepareProvider: true } : true,
      },
      serverInfo: { name: 'estorm' },
    }),
    shutdown: () => {
      shutdown = true;
      return null;
    },
    'textDocument/semanticTokens/full': (p) => ({ data: semanticTokens(textOf(p)) }),
    'textDocument/documentHighlight': (p) => eventHighlights(textOf(p), p.position),
    'textDocument/completion': (p) => completions(textOf(p), p.position),
    'textDocument/definition': (p) =>
      eventDefinitions(textOf(p), p.position).map((range) => ({ uri: p.textDocument.uri, range })),
    'textDocument/prepareRename': (p) => prepareRename(textOf(p), p.position),
    'textDocument/rename': (p) => {
      const edits = rename(textOf(p), p.position, p.newName);
      return edits && { changes: { [p.textDocument.uri]: edits } };
    },
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
      // RequestFailed (-32803) tells the client the message is for the user; anything else is a bug (-32603).
      const code = e instanceof RequestFailed ? -32803 : -32603;
      send({ jsonrpc: '2.0', id, error: { code, message: e instanceof Error ? e.message : String(e) } });
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
