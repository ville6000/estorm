/**
 * The estorm editor: edit a board on the left, see it on the right. Runs
 * entirely in the browser; the build inlines everything into one HTML file.
 */
import { Compartment, EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state';
import { drawSelection, EditorView, GutterMarker, keymap, lineNumberMarkers, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewlineKeepIndent } from '@codemirror/commands';
import { vim, Vim } from '@replit/codemirror-vim';
import { layout, parse, ParseError, svg } from '../src/index.ts';

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

const state = {
  name: 'untitled.estorm',
  handle: null as FileHandle | null,
  saved: '',
  errorLine: null as number | null,
  zoom: 1,
  size: { width: 0, height: 0 },
  vim: false,
};

function storage<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

// --- rendering ---------------------------------------------------------------

function renderBoard(): void {
  const text = sourceText();
  try {
    const l = layout(parse(text));
    board.innerHTML = svg(l);
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

// Vim must come first so its keys win over the default keymap.
const vimMode = new Compartment();

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      vimMode.of(state.vim ? vim({ status: true }) : []),
      lineNumbers(),
      errorLineField,
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

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
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

function exportSvg(): void {
  try {
    download(state.name.replace(/\.estorm$/, '') + '.svg', svg(layout(parse(sourceText()))) + '\n', 'image/svg+xml');
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    alert(`Fix the error first: line ${e.line}: ${e.message}`);
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
$('export').addEventListener('click', exportSvg);
$('zoom-in').addEventListener('click', () => zoomBy(1));
$('zoom-out').addEventListener('click', () => zoomBy(-1));
$('zoom-reset').addEventListener('click', () => {
  state.zoom = 1;
  applyZoom();
});
$('zoom-fit').addEventListener('click', zoomToFit);
vimButton.addEventListener('click', () => {
  setVim(!state.vim);
  view.focus();
});

helpButton.addEventListener('click', () => {
  cheatsheet.hidden = !cheatsheet.hidden;
  helpButton.setAttribute('aria-expanded', String(!cheatsheet.hidden));
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

const draft = storage(() => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')) as
  | { name: string; text: string }
  | null
  | undefined;
if (draft && typeof draft.text === 'string') {
  load(draft.text, draft.name || 'untitled.estorm', null, '');
} else {
  load(examples['checkout.estorm'] ?? '', 'checkout.estorm', null);
  zoomToFit();
}
