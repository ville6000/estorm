#!/usr/bin/env node
/**
 * estorm command line: render boards to SVG, check or lint them in CI,
 * summarise them, or preview one live in the browser while editing it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HINTS } from './hints.ts';
import { lint, parse, parseAll, ParseError, render, renderTimeline, summarize } from './index.ts';
import type { SvgOptions, Theme } from './index.ts';
import { serveStdio } from './lsp.ts';

const USAGE = `Usage:
  estorm render <file.estorm>...         write <file>.svg next to each file
  estorm render <file.estorm> -o <out>   write to <out> ('-' for stdout)
  estorm render -t <file.estorm>...      timeline view, to <file>.timeline.svg
  estorm check <file.estorm>...          report errors only
  estorm lint <file.estorm>...           errors and modelling warnings
  estorm summary <file.estorm>...        overview: actors, aggregates, gaps, hotspots
  estorm serve <file.estorm> [-p 8080]   live preview at http://localhost:8080
  estorm guide                           how to write boards, for AI agents and newcomers
  estorm lsp                             language server over stdio, for editors

Options:
  -o, --out <file>    output file for a single input
  -t, --timeline      render the timeline: events only, sections as swimlanes
  --theme <theme>     light (default for render), dark, or auto: follows the
                      viewer's colour scheme (default for serve)
  --no-legend         leave out the key to sticky colours and arrows
  --format <format>   for check and lint: text (default), or json: an array of
                      {file, line, severity, code, message, hint} on stdout
  -p, --port <port>   preview port (default 8080)
  -h, --help          show this help
  -v, --version       show the version`;

class UsageError extends Error {}

type Result = { out: string } | { error: string };

const READ_ERRORS: Record<string, string> = {
  ENOENT: 'no such file',
  EISDIR: 'is a directory',
  EACCES: 'permission denied',
};

/** FILE's text, or why it can't be read, such as "no such file". */
function readText(file: string): { text: string } | { reason: string } {
  try {
    return { text: readFileSync(file, 'utf8') };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { reason: READ_ERRORS[code ?? ''] ?? 'cannot read file' };
  }
}

/** A problem in a file, as `check` and `lint` report it. */
interface Diagnostic {
  file: string;
  /** Absent when the file can't be read. */
  line?: number;
  severity: 'error' | 'warning';
  /** An ErrorCode or WarningCode, or 'unreadable'. */
  code: string;
  message: string;
  /** How to fix it. */
  hint?: string;
}

/** "file:line: message", or "file: message" for the file as a whole. */
function formatDiagnostic({ file, line, message }: Diagnostic): string {
  return line === undefined ? `${file}: ${message}` : `${file}:${line}: ${message}`;
}

/** ERRORS, found in FILE, as diagnostics. */
function parseErrors(file: string, errors: ParseError[]): Diagnostic[] {
  return errors.map(({ line, code, message }): Diagnostic => ({
    file,
    line,
    severity: 'error',
    code,
    message,
    hint: HINTS[code],
  }));
}

/**
 * FILE's errors and, with WARNINGS, the lint warnings for what parsed, by
 * line; an error on a line comes before a warning on it.
 */
function diagnose(file: string, warnings: boolean): Diagnostic[] {
  const source = readText(file);
  if ('reason' in source) return [{ file, severity: 'error', code: 'unreadable', message: source.reason }];
  const { board, errors } = parseAll(source.text);
  const advice = warnings
    ? lint(board).map(({ line, code, message }): Diagnostic => ({
        file,
        line,
        severity: 'warning',
        code,
        message,
        hint: HINTS[code],
      }))
    : [];
  return [...parseErrors(file, errors), ...advice].sort((a, b) => a.line! - b.line!);
}

/** FILE through CONVERT (SVG by default), or its errors as "file:line: message" lines. */
function compile(file: string, convert: (text: string) => string = render): Result {
  const source = readText(file);
  if ('reason' in source) return { error: `${file}: ${source.reason}` };
  const { text } = source;
  try {
    return { out: convert(text) };
  } catch (e) {
    if (e instanceof ParseError) {
      return { error: parseErrors(file, parseAll(text).errors).map(formatDiagnostic).join('\n') };
    }
    throw e;
  }
}

function svgPath(file: string, suffix = '.svg'): string {
  return file.replace(/\.estorm$/, '') + suffix;
}

const THEMES: Theme[] = ['light', 'dark', 'auto'];

function parseTheme(value: string | undefined, fallback: Theme): Theme {
  if (value === undefined) return fallback;
  if (!THEMES.includes(value as Theme)) throw new UsageError(`invalid theme: ${value}`);
  return value as Theme;
}

function renderFiles(files: string[], out: string | undefined, timeline: boolean, options: SvgOptions): number {
  if (files.length === 0) throw new UsageError('render needs at least one file');
  if (out !== undefined && files.length > 1) throw new UsageError('-o works with a single file only');
  let failed = 0;
  for (const file of files) {
    const result = compile(file, (text) => (timeline ? renderTimeline : render)(text, options));
    if ('error' in result) {
      console.error(result.error);
      failed++;
    } else if (out === '-') {
      process.stdout.write(result.out);
    } else {
      const target = out ?? svgPath(file, timeline ? '.timeline.svg' : '.svg');
      writeFileSync(target, result.out);
      console.error(`wrote ${target}`);
    }
  }
  return failed ? 1 : 0;
}

type Format = 'text' | 'json';

/**
 * Reports the errors in FILES and, for lint, the warnings too: as text on
 * stderr, or as one JSON array on stdout (`[]` when all is well).
 */
function report(command: 'check' | 'lint', files: string[], format: Format): number {
  if (files.length === 0) throw new UsageError(`${command} needs at least one file`);
  const found = files.flatMap((file) => diagnose(file, command === 'lint'));
  if (format === 'json') process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
  else process.stderr.write(found.map((d) => `${formatDiagnostic(d)}\n`).join(''));
  return found.length ? 1 : 0;
}

// The guide `estorm guide` prints, at the package root: next to src/ while
// developing and next to dist/ when installed.
const GUIDE = new URL('../GUIDE.md', import.meta.url);

function guide(): number {
  process.stdout.write(readFileSync(GUIDE, 'utf8'));
  return 0;
}

function summary(files: string[]): number {
  if (files.length === 0) throw new UsageError('summary needs at least one file');
  let failed = 0;
  files.forEach((file, i) => {
    const result = compile(file, (text) => summarize(parse(text)));
    if ('error' in result) {
      console.error(result.error);
      failed++;
    } else {
      // With several files, a heading tells their summaries apart.
      const heading = files.length > 1 ? `${i ? '\n' : ''}# ${file}\n\n` : '';
      process.stdout.write(heading + result.out);
    }
  });
  return failed ? 1 : 0;
}

// The page serve shows, built from web/preview.html. From src/ (while
// developing) and from dist/ alike, it's in ../dist/web.
const PREVIEW_PAGE = new URL('../dist/web/preview.html', import.meta.url);

/**
 * Serves a live preview of FILE: a page that fetches the file's text from
 * /board every second and draws it, so it follows edits in any editor.
 */
function serve(files: string[], port: number, options: SvgOptions): Promise<number> {
  const [file] = files;
  if (files.length !== 1 || file === undefined) throw new UsageError('serve needs exactly one file');
  const server = createServer((req, res) => {
    // Routes on the path alone: bookmarks and extensions may add a query.
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/') {
      const page = readText(fileURLToPath(PREVIEW_PAGE));
      if ('reason' in page) {
        res
          .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Preview page not built: run npm run build');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page.text);
      }
    } else if (path === '/board') {
      const board = readText(file);
      if ('reason' in board) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${file}: ${board.reason}`);
      } else {
        const body = { name: basename(file), text: board.text, theme: options.theme, legend: options.legend };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
      }
    } else {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.on('error', (e) => {
      console.error(e.message);
      resolve(1);
    });
    // Loopback only: the preview is for whoever is editing, not the network.
    server.listen(port, '127.0.0.1', () => console.error(`Previewing ${file} at http://localhost:${port}`));
  });
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      out: { type: 'string', short: 'o' },
      timeline: { type: 'boolean', short: 't' },
      theme: { type: 'string' },
      legend: { type: 'boolean', default: true },
      port: { type: 'string', short: 'p', default: '8080' },
      format: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      // Passed by some LSP clients; stdio is the only transport anyway.
      stdio: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }
  const [command, ...files] = positionals;
  if (values.format !== undefined && command !== 'check' && command !== 'lint') {
    throw new UsageError('--format works with check and lint only');
  }
  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') throw new UsageError(`invalid format: ${format}`);
  switch (command) {
    case 'render':
      return renderFiles(files, values.out, values.timeline ?? false, {
        theme: parseTheme(values.theme, 'light'),
        legend: values.legend,
      });
    case 'check':
    case 'lint':
      return report(command, files, format);
    case 'guide':
      if (files.length) throw new UsageError('guide takes no files');
      return guide();
    case 'summary':
      return summary(files);
    case 'serve': {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`invalid port: ${values.port}`);
      return serve(files, port, { theme: parseTheme(values.theme, 'auto'), legend: values.legend });
    }
    case 'lsp':
      serveStdio();
      return new Promise(() => {});
    default:
      throw new UsageError(command ? `unknown command: ${command}` : 'missing command');
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError || (e instanceof Error && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'))) {
      console.error(`estorm: ${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  },
);
