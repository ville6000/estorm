/**
 * The live preview for `estorm serve`: the board from the editor, without the
 * editor. Polls the server for the file's text and redraws it when it changes,
 * so the board follows edits made in any text editor.
 */
import { layout, lint, parseAll, summarize, svg, timeline, type Board, type Theme } from '../src/index.ts';
import { copies } from './copy.ts';
import { download, svgToPng } from './files.ts';
import { escape, summaryHtml, warningsHtml } from './html.ts';
import * as prefs from './prefs.ts';
import { viewport } from './viewport.ts';

/** What the server sends from /board: the file and the options serve was given. */
interface Served {
  name: string;
  text: string;
  theme: Theme;
  legend: boolean;
}

const POLL_MS = 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $<HTMLDivElement>('board');
const errorList = $<HTMLDivElement>('errors');
const fileName = $<HTMLSpanElement>('file-name');
const exportPicker = $<HTMLSelectElement>('export');
const timelineButton = $<HTMLButtonElement>('timeline');
const summaryPanel = $<HTMLElement>('summary');
const summaryBody = $<HTMLDivElement>('summary-body');
const warningList = $<HTMLDivElement>('warnings');
const summaryButton = $<HTMLButtonElement>('summary-toggle');

const boardView = viewport(board.parentElement!, board, $('zoom-reset'));

const state = {
  served: null as Served | null,
  /** The last board that parsed, for export. */
  ast: null as Board | null,
  timeline: prefs.loadTimeline(),
  summary: '',
};

const boardLayout = (ast: Board) => (state.timeline ? timeline(ast) : layout(ast));

/** Lists ERRORS above the board, or hides the list if there are none, and dims what's stale. */
function showErrors(errors: string[]): void {
  errorList.innerHTML = errors.map((e) => `<p>${escape(e)}</p>`).join('');
  errorList.hidden = !errors.length;
  board.classList.toggle('stale', errors.length > 0);
  summaryPanel.classList.toggle('stale', errors.length > 0);
}

/** Draws the served board, or lists its errors and leaves the last board dimmed. */
function renderBoard(): void {
  const served = state.served;
  if (!served) return;
  const { board: ast, errors } = parseAll(served.text);
  showErrors(errors.map((e) => `${served.name}:${e.line}: ${e.message}`));
  if (errors.length) return;
  state.ast = ast;
  boardView.show(svg(boardLayout(ast), { theme: served.theme, legend: served.legend }));
  state.summary = summarize(ast);
  summaryBody.innerHTML = summaryHtml(state.summary);
  const warnings = lint(ast);
  warningList.innerHTML = warningsHtml(warnings);
  summaryButton.textContent = warnings.length ? `Summary (${warnings.length})` : 'Summary';
}

/** Fetches the file; redraws if it changed. Returns whether it was drawn for the first time. */
async function refresh(): Promise<boolean> {
  try {
    const res = await fetch('/board', { cache: 'no-store' });
    if (!res.ok) {
      // Can't read the file: forget it, so it's drawn again once it's back.
      state.served = null;
      showErrors([await res.text()]);
      return false;
    }
    const served = (await res.json()) as Served;
    const first = state.ast === null;
    fileName.classList.remove('stopped');
    fileName.title = '';
    if (served.text === state.served?.text) return false;
    state.served = served;
    fileName.textContent = served.name;
    document.title = `estorm · ${served.name}`;
    renderBoard();
    return first && state.ast !== null;
  } catch {
    // The server stopped; keep showing the last board.
    fileName.classList.add('stopped');
    fileName.title = 'estorm serve has stopped: changes to the file no longer show';
    return false;
  }
}

async function poll(): Promise<void> {
  if (await refresh()) boardView.fit();
  setTimeout(() => void poll(), POLL_MS);
}

async function exportBoard(format: string): Promise<void> {
  if (!state.ast || !state.served) return;
  const { theme: served, legend, name } = state.served;
  const screen = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const text = svg(boardLayout(state.ast), { theme: served === 'auto' ? screen : served, legend });
  const base = name.replace(/\.estorm$/, '');
  if (format === 'svg') download(`${base}.svg`, text + '\n', 'image/svg+xml');
  else if (format === 'png') download(`${base}.png`, await svgToPng(text), 'image/png');
}

// --- page --------------------------------------------------------------------

const on = (id: string, f: () => unknown) => $(id).addEventListener('click', () => void f());

on('zoom-in', () => boardView.step(1));
on('zoom-out', () => boardView.step(-1));
on('zoom-reset', () => boardView.setZoom(1));
on('zoom-fit', boardView.fit);
on('timeline', () => {
  state.timeline = !state.timeline;
  timelineButton.setAttribute('aria-pressed', String(state.timeline));
  prefs.saveTimeline(state.timeline);
  renderBoard();
  boardView.fit();
});
on('summary-toggle', () => {
  summaryPanel.hidden = !summaryPanel.hidden;
  summaryButton.setAttribute('aria-expanded', String(!summaryPanel.hidden));
});
copies($('copy-summary'), () => state.summary, 'Copied');

exportPicker.addEventListener('change', () => {
  const format = exportPicker.value;
  exportPicker.value = '';
  void exportBoard(format);
});

timelineButton.setAttribute('aria-pressed', String(state.timeline));
void poll();
