/**
 * The estorm editor: edit a board on the left, see it on the right. Runs
 * entirely in the browser; the build inlines everything into one HTML file.
 */
import { Compartment, EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  GutterMarker,
  keymap,
  lineNumberMarkers,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewlineKeepIndent } from '@codemirror/commands';
import { vim, Vim } from '@replit/codemirror-vim';
import {
  layout,
  lint,
  parse,
  ParseError,
  summarize,
  svg,
  timeline,
  type Board,
  type Layout,
  type Warning,
} from '../src/index.ts';
import { tokenize } from '../src/highlight.ts';

// File System Access API: Chromium only, so feature-detected.
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type PickerOptions = { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] };
declare global {
  interface Window {
    showOpenFilePicker?: (o?: PickerOptions) => Promise<FileHandle[]>;
    showSaveFilePicker?: (o?: PickerOptions) => Promise<FileHandle>;
  }
}

const PICKER_TYPES = [{ description: 'estorm board', accept: { 'text/plain': ['.estorm'] } }];
const DRAFT_KEY = 'estorm:draft';
const VIM_KEY = 'estorm:vim';
const TIMELINE_KEY = 'estorm:timeline';
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const examples = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../examples/*.estorm', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.split('/').pop()!, text]),
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $<HTMLDivElement>('board');
const errorBar = $<HTMLButtonElement>('error');
const fileName = $<HTMLSpanElement>('file-name');
const fileInput = $<HTMLInputElement>('file-input');
const examplePicker = $<HTMLSelectElement>('examples');
const cheatsheet = $<HTMLElement>('cheatsheet');
const helpButton = $<HTMLButtonElement>('help');
const vimButton = $<HTMLButtonElement>('vim');
const timelineButton = $<HTMLButtonElement>('timeline');
const summaryPanel = $<HTMLElement>('summary');
const summaryBody = $<HTMLDivElement>('summary-body');
const warningList = $<HTMLDivElement>('warnings');
const summaryButton = $<HTMLButtonElement>('summary-toggle');

const state = {
  name: 'untitled.estorm',
  handle: null as FileHandle | null,
  saved: '',
  errorLine: null as number | null,
  zoom: 1,
  size: { width: 0, height: 0 },
  vim: false,
  timeline: false,
  summary: '',
};

function storage<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

// --- rendering ---------------------------------------------------------------

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The summary's Markdown (headings, bullets, paragraphs) as HTML. */
function summaryHtml(markdown: string): string {
  return markdown
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      if (block.startsWith('## ')) return `<h3>${escape(block.slice(3))}</h3>`;
      if (block.startsWith('- ')) {
        return `<ul>${block
          .split('\n')
          .map((l) => `<li>${escape(l.slice(2))}</li>`)
          .join('')}</ul>`;
      }
      return `<p>${escape(block)}</p>`;
    })
    .join('');
}

/** Lint warnings as a heading and a list of buttons that jump to their lines. */
function warningsHtml(warnings: Warning[]): string {
  if (!warnings.length) return '';
  const items = warnings
    .map((w) => `<li><button type="button" data-line="${w.line}">line ${w.line}: ${escape(w.message)}</button></li>`)
    .join('');
  return `<h3>Warnings (${warnings.length})</h3><ul>${items}</ul>`;
}

/** The board's layout in the current view. */
function boardLayout(ast: Board): Layout {
  return state.timeline ? timeline(ast) : layout(ast);
}

function renderBoard(): void {
  const text = sourceText();
  try {
    const ast = parse(text);
    const l = boardLayout(ast);
    board.innerHTML = svg(l, { theme: 'auto' });
    state.summary = summarize(ast);
    summaryBody.innerHTML = summaryHtml(state.summary);
    const warnings = lint(ast);
    warningList.innerHTML = warningsHtml(warnings);
    summaryButton.textContent = warnings.length ? `Summary (${warnings.length})` : 'Summary';
    summaryPanel.classList.remove('stale');
    state.size = { width: l.width, height: l.height };
    state.errorLine = null;
    errorBar.hidden = true;
    board.classList.remove('stale');
    applyZoom();
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    state.errorLine = e.line;
    errorBar.textContent = `line ${e.line}: ${e.message}`;
    errorBar.hidden = false;
    board.classList.add('stale');
    summaryPanel.classList.add('stale');
  }
  view.dispatch({ effects: setErrorLine.of(state.errorLine) });
  fileName.textContent = state.name;
  fileName.classList.toggle('dirty', text !== state.saved);
  storage(() => localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: state.name, text })));
}

let pending = 0;
function scheduleRender(): void {
  clearTimeout(pending);
  pending = window.setTimeout(renderBoard, 120);
}

// --- zoom --------------------------------------------------------------------

function applyZoom(): void {
  const el = board.querySelector('svg');
  if (el) {
    el.style.width = `${state.size.width * state.zoom}px`;
    el.style.height = `${state.size.height * state.zoom}px`;
  }
  $('zoom-reset').textContent = `${Math.round(state.zoom * 100)}%`;
}

function zoomBy(step: number): void {
  const i = ZOOMS.findIndex((z) => z >= state.zoom - 1e-6);
  state.zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? ZOOMS.length - 1 : i) + step))]!;
  applyZoom();
}

function zoomToFit(): void {
  if (!state.size.width) return;
  const available = board.parentElement!.clientWidth - 32;
  state.zoom = Math.min(2, Math.max(0.1, available / state.size.width));
  applyZoom();
}

// --- editing ---------------------------------------------------------------

/** Marks the line number of the line with a parse error. */
const setErrorLine = StateEffect.define<number | null>();
const badLine = new (class extends GutterMarker {
  override elementClass = 'bad';
})();
const errorLineField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const line = e.value;
      if (line === null || line > tr.state.doc.lines) return RangeSet.empty;
      return RangeSet.of(badLine.range(tr.state.doc.line(line).from));
    }
    return markers.map(tr.changes);
  },
  provide: (f) => lineNumberMarkers.from(f),
});

/** The name of the event under the cursor, if any. */
function eventAtCursor(state: EditorState): string | null {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const at = head - line.from;
  const t = tokenize(line.text).find((t) => t.kind === 'event' && t.from <= at && at <= t.to);
  return t ? line.text.slice(t.from, t.to) : null;
}

/**
 * Colours each token like the sticky it becomes (see highlight.ts), and marks
 * every mention of the event under the cursor.
 */
function highlightLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const current = eventAtCursor(view.state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      for (const t of tokenize(line.text)) {
        const match = t.kind === 'event' && line.text.slice(t.from, t.to) === current;
        const cls = match ? 'tok-event tok-match' : `tok-${t.kind}`;
        builder.add(line.from + t.from, line.from + t.to, Decoration.mark({ class: cls }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = highlightLines(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = highlightLines(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

// Vim must come first so its keys win over the default keymap.
const vimMode = new Compartment();

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      vimMode.of(state.vim ? vim({ status: true }) : []),
      lineNumbers(),
      errorLineField,
      highlighter,
      history(),
      drawSelection(),
      EditorState.tabSize.of(2),
      keymap.of([
        {
          key: 'Tab',
          run: (v) => (v.dispatch(v.state.replaceSelection('  '), { scrollIntoView: true, userEvent: 'input' }), true),
        },
        // Keep the indentation of the current line.
        { key: 'Enter', run: insertNewlineKeepIndent },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({
        'aria-label': 'estorm source',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) scheduleRender();
      }),
    ],
  });
}

const view = new EditorView({ parent: $('source') });

function sourceText(): string {
  return view.state.doc.toString();
}

function goToLine(line: number): void {
  if (line > view.state.doc.lines) return;
  const { from, to } = view.state.doc.line(line);
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  view.focus();
}

function setVim(on: boolean): void {
  state.vim = on;
  view.dispatch({ effects: vimMode.reconfigure(on ? vim({ status: true }) : []) });
  vimButton.setAttribute('aria-pressed', String(on));
  storage(() => localStorage.setItem(VIM_KEY, on ? '1' : ''));
}

// :w and :saveas in vim mode.
Vim.defineEx('write', 'w', () => void save());
Vim.defineEx('saveas', 'sav', () => void saveAs());

board.addEventListener('click', (e) => {
  const g = (e.target as Element).closest('[data-line]');
  if (g) goToLine(Number(g.getAttribute('data-line')));
});

warningList.addEventListener('click', (e) => {
  const button = (e.target as Element).closest('[data-line]');
  if (button) goToLine(Number(button.getAttribute('data-line')));
});

errorBar.addEventListener('click', () => {
  if (state.errorLine) goToLine(state.errorLine);
});

// --- files -------------------------------------------------------------------

function load(text: string, name: string, handle: FileHandle | null, saved = text): void {
  view.setState(createState(text));
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
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
      if (handle) load(await (await handle.getFile()).text(), handle.name, handle);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') throw e;
    }
  } else {
    fileInput.click();
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (file) load(await file.text(), file.name, null);
  fileInput.value = '';
});

function download(name: string, data: string | Blob, type: string): void {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writeTo(handle: FileHandle): Promise<void> {
  const w = await handle.createWritable();
  await w.write(sourceText());
  await w.close();
}

async function saveAs(): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: state.name, types: PICKER_TYPES });
      await writeTo(handle);
      state.handle = handle;
      state.name = handle.name;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      throw e;
    }
  } else {
    download(state.name, sourceText(), 'text/plain');
  }
  state.saved = sourceText();
  renderBoard();
}

async function save(): Promise<void> {
  if (!state.handle) return saveAs();
  await writeTo(state.handle);
  state.saved = sourceText();
  renderBoard();
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

function exportSvg(): void {
  const text = boardSvg();
  if (text !== null) download(state.name.replace(/\.estorm$/, '') + '.svg', text + '\n', 'image/svg+xml');
}

// Safari refuses canvases over 16,777,216 pixels; every browser over 16,384 per side.
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 16_384;

/** Draws the board on a canvas at twice its size, or less if the board is too big. */
async function exportPng(): Promise<void> {
  const text = boardSvg();
  if (text === null) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)), MAX_CANVAS_SIDE / Math.max(w, h));
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.floor(w * scale),
      height: Math.floor(h * scale),
    });
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The board is too big to export as PNG');
    download(state.name.replace(/\.estorm$/, '') + '.png', png, 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file && confirmDiscard()) load(await file.text(), file.name, null);
});

window.addEventListener('beforeunload', (e) => {
  if (sourceText() !== state.saved && state.handle) e.preventDefault();
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

// --- toolbar -----------------------------------------------------------------

$('new').addEventListener('click', () => {
  if (confirmDiscard()) load('', 'untitled.estorm', null);
});
$('open').addEventListener('click', () => void open());
$('save').addEventListener('click', () => void save());
$('save-as').addEventListener('click', () => void saveAs());
const exportPicker = $<HTMLSelectElement>('export');
exportPicker.addEventListener('change', () => {
  const format = exportPicker.value;
  exportPicker.value = '';
  if (format === 'svg') exportSvg();
  else if (format === 'png') void exportPng();
});
$('zoom-in').addEventListener('click', () => zoomBy(1));
$('zoom-out').addEventListener('click', () => zoomBy(-1));
$('zoom-reset').addEventListener('click', () => {
  state.zoom = 1;
  applyZoom();
});
$('zoom-fit').addEventListener('click', zoomToFit);
timelineButton.addEventListener('click', () => {
  state.timeline = !state.timeline;
  timelineButton.setAttribute('aria-pressed', String(state.timeline));
  storage(() => localStorage.setItem(TIMELINE_KEY, state.timeline ? '1' : ''));
  renderBoard();
  zoomToFit();
});
vimButton.addEventListener('click', () => {
  setVim(!state.vim);
  view.focus();
});

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

helpButton.addEventListener('click', () => togglePanel(cheatsheet));
summaryButton.addEventListener('click', () => togglePanel(summaryPanel));

$('copy-summary').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(state.summary);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => (button.textContent = 'Copy Markdown'), 1500);
});

for (const name of Object.keys(examples).sort()) {
  examplePicker.append(new Option(name, name));
}
examplePicker.addEventListener('change', () => {
  const name = examplePicker.value;
  examplePicker.value = '';
  if (name && confirmDiscard()) load(examples[name]!, name, null, '');
});

// --- start -------------------------------------------------------------------

state.vim = storage(() => localStorage.getItem(VIM_KEY) === '1') ?? false;
vimButton.setAttribute('aria-pressed', String(state.vim));
state.timeline = storage(() => localStorage.getItem(TIMELINE_KEY) === '1') ?? false;
timelineButton.setAttribute('aria-pressed', String(state.timeline));

const draft = storage(() => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')) as
  { name: string; text: string } | null | undefined;
if (draft && typeof draft.text === 'string') {
  load(draft.text, draft.name || 'untitled.estorm', null, '');
} else {
  load(examples['checkout.estorm'] ?? '', 'checkout.estorm', null);
  zoomToFit();
}
