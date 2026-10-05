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
  estorm lsp                             language server over stdio, for editors

Options:
  -o, --out <file>    output file for a single input
  -t, --timeline      render the timeline: events only, sections as swimlanes
  --theme <theme>     light (default for render), dark, or auto: follows the
                      viewer's colour scheme (default for serve)
  --no-legend         leave out the key to sticky colours and arrows
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

/** FILE's text, or why it can't be read. */
function readText(file: string): { text: string } | { error: string } {
  try {
    return { text: readFileSync(file, 'utf8') };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { error: `${file}: ${READ_ERRORS[code ?? ''] ?? 'cannot read file'}` };
  }
}

/** FILE through CONVERT (SVG by default), or its errors as "file:line: message" lines. */
function compile(file: string, convert: (text: string) => string = render): Result {
  const source = readText(file);
  if ('error' in source) return source;
  const { text } = source;
  try {
    return { out: convert(text) };
  } catch (e) {
    if (e instanceof ParseError) {
      return {
        error: parseAll(text)
          .errors.map((err) => `${file}:${err.line}: ${err.message}`)
          .join('\n'),
      };
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

function check(files: string[]): number {
  if (files.length === 0) throw new UsageError('check needs at least one file');
  const errors = files.map((f) => compile(f)).filter((r) => 'error' in r);
  for (const r of errors) console.error(r.error);
  return errors.length ? 1 : 0;
}

function lintFiles(files: string[]): number {
  if (files.length === 0) throw new UsageError('lint needs at least one file');
  let failed = 0;
  for (const file of files) {
    // Errors and warnings by line, warnings only for what parsed.
    const result = compile(file, (text) => {
      const { board, errors } = parseAll(text);
      return [...errors, ...lint(board)]
        .sort((a, b) => a.line - b.line)
        .map((w) => `${file}:${w.line}: ${w.message}\n`)
        .join('');
    });
    const out = 'error' in result ? `${result.error}\n` : result.out;
    if (out) failed++;
    process.stderr.write(out);
  }
  return failed ? 1 : 0;
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
      if ('error' in page) {
        res
          .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Preview page not built: run npm run build');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page.text);
      }
    } else if (path === '/board') {
      const board = readText(file);
      if ('error' in board) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(board.error);
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
  switch (command) {
    case 'render':
      return renderFiles(files, values.out, values.timeline ?? false, {
        theme: parseTheme(values.theme, 'light'),
        legend: values.legend,
      });
    case 'check':
      return check(files);
    case 'lint':
      return lintFiles(files);
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
