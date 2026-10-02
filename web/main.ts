/**
 * The estorm editor: edit a board on the left, see it on the right. Runs
 * entirely in the browser; the build inlines everything into one HTML file.
 *
 * This file holds the app's state and wires the page to it; the parts live in
 * codemirror.ts (the source editor), files.ts (open, save, export), html.ts
 * (panel contents), prefs.ts (local storage), share.ts (links) and zoom.ts.
 */
import { EditorView } from '@codemirror/view';
import {
  layout,
  lint,
  parse,
  parseAll,
  ParseError,
  summarize,
  svg,
  timeline,
  type Board,
  type Layout,
} from '../src/index.ts';
import { createState, goToLine, setErrorLines, setVimKeys, Vim } from './codemirror.ts';
import { canPick, download, type FileHandle, pickFile, pickSaveFile, svgToPng, writeTo } from './files.ts';
import { errorsHtml, summaryHtml, warningsHtml } from './html.ts';
import * as prefs from './prefs.ts';
import { decode, encode } from './share.ts';
import { zoomStep, zoomToFit } from './zoom.ts';

// Where links from the downloaded file point, since file:// links don't work for others.
const PUBLIC_URL = 'https://ville6000.github.io/estorm/';

const examples = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../examples/*.estorm', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.split('/').pop()!, text]),
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $<HTMLDivElement>('board');
const errorList = $<HTMLDivElement>('errors');
const fileName = $<HTMLSpanElement>('file-name');
const fileInput = $<HTMLInputElement>('file-input');
const examplePicker = $<HTMLSelectElement>('examples');
const exportPicker = $<HTMLSelectElement>('export');
const cheatsheet = $<HTMLElement>('cheatsheet');
const helpButton = $<HTMLButtonElement>('help');
const vimButton = $<HTMLButtonElement>('vim');
const timelineButton = $<HTMLButtonElement>('timeline');
const zoomReset = $<HTMLButtonElement>('zoom-reset');
const summaryPanel = $<HTMLElement>('summary');
const summaryBody = $<HTMLDivElement>('summary-body');
const warningList = $<HTMLDivElement>('warnings');
const summaryButton = $<HTMLButtonElement>('summary-toggle');

const state = {
  name: 'untitled.estorm',
  handle: null as FileHandle | null,
  saved: '',
  zoom: 1,
  size: { width: 0, height: 0 },
  vim: prefs.loadVim(),
  timeline: prefs.loadTimeline(),
  summary: '',
};

const view = new EditorView({ parent: $('source') });

function sourceText(): string {
  return view.state.doc.toString();
}

// --- rendering ---------------------------------------------------------------

/** The board's layout in the current view. */
function boardLayout(ast: Board): Layout {
  return state.timeline ? timeline(ast) : layout(ast);
}

/** Draws the board, or lists the errors and leaves the last board dimmed. */
function renderBoard(): void {
  const text = sourceText();
  const { board: ast, errors } = parseAll(text);
  errorList.innerHTML = errorsHtml(errors);
  errorList.hidden = !errors.length;
  board.classList.toggle('stale', errors.length > 0);
  summaryPanel.classList.toggle('stale', errors.length > 0);
  if (!errors.length) {
    const l = boardLayout(ast);
    board.innerHTML = svg(l, { theme: 'auto' });
    state.size = { width: l.width, height: l.height };
    applyZoom();
    state.summary = summarize(ast);
    summaryBody.innerHTML = summaryHtml(state.summary);
    const warnings = lint(ast);
    warningList.innerHTML = warningsHtml(warnings);
    summaryButton.textContent = warnings.length ? `Summary (${warnings.length})` : 'Summary';
  }
  view.dispatch({ effects: setErrorLines.of(errors.map((e) => e.line)) });
  fileName.textContent = state.name;
  fileName.classList.toggle('dirty', text !== state.saved);
  prefs.saveDraft({ name: state.name, text });
}

let pending = 0;
function scheduleRender(): void {
  clearTimeout(pending);
  pending = window.setTimeout(renderBoard, 120);
}

function applyZoom(): void {
  const el = board.querySelector('svg');
  if (el) {
    el.style.width = `${state.size.width * state.zoom}px`;
    el.style.height = `${state.size.height * state.zoom}px`;
  }
  zoomReset.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(zoom: number): void {
  state.zoom = zoom;
  applyZoom();
}

function fitBoard(): void {
  if (state.size.width) setZoom(zoomToFit(board.parentElement!.clientWidth - 32, state.size.width));
}

// --- files -------------------------------------------------------------------

/** Replaces the source with TEXT, as file NAME; SAVED is what's on disk, to tell if there are changes. */
function load(text: string, name: string, handle: FileHandle | null, saved = text): void {
  view.setState(createState(text, { vim: state.vim, onChange: scheduleRender }));
  state.name = name;
  state.handle = handle;
  state.saved = saved;
  renderBoard();
}

function confirmDiscard(): boolean {
  return sourceText() === state.saved || confirm('Discard unsaved changes?');
}

async function open(): Promise<void> {
  if (!confirmDiscard()) return;
  if (!canPick()) return fileInput.click();
  const picked = await pickFile();
  if (picked) load(picked.text, picked.handle.name, picked.handle);
}

function markSaved(): void {
  state.saved = sourceText();
  renderBoard();
}

async function saveAs(): Promise<void> {
  if (canPick()) {
    const handle = await pickSaveFile(state.name);
    if (!handle) return;
    await writeTo(handle, sourceText());
    state.handle = handle;
    state.name = handle.name;
  } else {
    download(state.name, sourceText(), 'text/plain');
  }
  markSaved();
}

async function save(): Promise<void> {
  if (!state.handle) return saveAs();
  await writeTo(state.handle, sourceText());
  markSaved();
}

/** The board as SVG in the theme on screen, or null after telling the user to fix the parse error first. */
function boardSvg(): string | null {
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    return svg(boardLayout(parse(sourceText())), { theme });
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    alert(`Fix the error first: line ${e.line}: ${e.message}`);
    return null;
  }
}

async function exportBoard(format: string): Promise<void> {
  const text = boardSvg();
  if (text === null) return;
  const base = state.name.replace(/\.estorm$/, '');
  if (format === 'svg') download(`${base}.svg`, text + '\n', 'image/svg+xml');
  else if (format === 'png') download(`${base}.png`, await svgToPng(text), 'image/png');
}

/**
 * Opens the board in the URL's fragment, if any, then drops the fragment so a
 * reload opens the draft.
 */
async function openShared(): Promise<void> {
  const shared = await decode(location.hash);
  if (!shared) return;
  window.history.replaceState(null, '', location.pathname + location.search);
  if (shared.text !== sourceText() && !confirmDiscard()) return;
  load(shared.text, shared.name, null, '');
  fitBoard();
}

async function shareLink(): Promise<string> {
  const base = location.protocol === 'file:' ? PUBLIC_URL : location.origin + location.pathname;
  return `${base}#${await encode({ name: state.name, text: sourceText() })}`;
}

// --- page --------------------------------------------------------------------

const on = (id: string, f: () => unknown) => $(id).addEventListener('click', () => void f());

/** Clicks on anything in EL with a data-line attribute jump to that line. */
function jumpsToLines(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    const target = (e.target as Element).closest('[data-line]');
    if (target) goToLine(view, Number(target.getAttribute('data-line')));
  });
}

/** Shows TEXT on BUTTON for a moment, then its label again. */
function flash(button: HTMLButtonElement, text: string): void {
  const label = button.dataset.label ?? (button.dataset.label = button.textContent ?? '');
  button.textContent = text;
  setTimeout(() => (button.textContent = label), 1500);
}

/** Clicking button ID copies the text from GET, saying DONE when copied. */
function copies(id: string, get: () => string | Promise<string>, done: string): void {
  const button = $<HTMLButtonElement>(id);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await get());
      flash(button, done);
    } catch {
      flash(button, 'Copy failed');
    }
  });
}

/** Shows PANEL, or hides it if shown; the panels share a corner, so one at a time. */
function togglePanel(panel: HTMLElement): void {
  const show = panel.hidden;
  for (const [p, button] of [
    [cheatsheet, helpButton],
    [summaryPanel, summaryButton],
  ] as const) {
    p.hidden = !(show && p === panel);
    button.setAttribute('aria-expanded', String(!p.hidden));
  }
}

function setVim(vim: boolean): void {
  state.vim = vim;
  setVimKeys(view, vim);
  vimButton.setAttribute('aria-pressed', String(vim));
  prefs.saveVim(vim);
}

function setTimeline(timeline: boolean): void {
  state.timeline = timeline;
  timelineButton.setAttribute('aria-pressed', String(timeline));
  prefs.saveTimeline(timeline);
}

jumpsToLines(board);
jumpsToLines(warningList);
jumpsToLines(errorList);

on('new', () => confirmDiscard() && load('', 'untitled.estorm', null));
on('open', open);
on('save', save);
on('save-as', saveAs);
on('zoom-in', () => setZoom(zoomStep(state.zoom, 1)));
on('zoom-out', () => setZoom(zoomStep(state.zoom, -1)));
on('zoom-reset', () => setZoom(1));
on('zoom-fit', fitBoard);
on('timeline', () => {
  setTimeline(!state.timeline);
  renderBoard();
  fitBoard();
});
on('vim', () => {
  setVim(!state.vim);
  view.focus();
});
on('help', () => togglePanel(cheatsheet));
on('summary-toggle', () => togglePanel(summaryPanel));
copies('share', shareLink, 'Link copied');
copies('copy-summary', () => state.summary, 'Copied');

exportPicker.addEventListener('change', () => {
  const format = exportPicker.value;
  exportPicker.value = '';
  void exportBoard(format);
});

for (const name of Object.keys(examples).sort()) {
  examplePicker.append(new Option(name, name));
}
examplePicker.addEventListener('change', () => {
  const name = examplePicker.value;
  examplePicker.value = '';
  if (name && confirmDiscard()) load(examples[name]!, name, null, '');
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (file) load(await file.text(), file.name, null);
  fileInput.value = '';
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && confirmDiscard()) load(await file.text(), file.name, null);
});

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's') {
    e.preventDefault();
    void (e.shiftKey ? saveAs() : save());
  } else if (key === 'o') {
    e.preventDefault();
    void open();
  }
});

// :w and :saveas in vim mode.
Vim.defineEx('write', 'w', () => void save());
Vim.defineEx('saveas', 'sav', () => void saveAs());

window.addEventListener('beforeunload', (e) => {
  if (sourceText() !== state.saved && state.handle) e.preventDefault();
});
window.addEventListener('hashchange', () => void openShared());

// --- start -------------------------------------------------------------------

vimButton.setAttribute('aria-pressed', String(state.vim));
timelineButton.setAttribute('aria-pressed', String(state.timeline));

const draft = prefs.loadDraft();
if (draft) {
  load(draft.text, draft.name, null, '');
} else {
  load(examples['checkout.estorm'] ?? '', 'checkout.estorm', null);
  fitBoard();
}
void openShared();
