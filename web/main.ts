/**
 * The estorm editor: edit a board on the left, see it on the right. Runs
 * entirely in the browser; the build inlines everything into one HTML file.
 */
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
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const examples = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../examples/*.estorm', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.split('/').pop()!, text]),
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>('source');
const gutter = $<HTMLPreElement>('gutter');
const board = $<HTMLDivElement>('board');
const errorBar = $<HTMLButtonElement>('error');
const fileName = $<HTMLSpanElement>('file-name');
const fileInput = $<HTMLInputElement>('file-input');
const examplePicker = $<HTMLSelectElement>('examples');
const cheatsheet = $<HTMLElement>('cheatsheet');
const helpButton = $<HTMLButtonElement>('help');

const state = {
  name: 'untitled.estorm',
  handle: null as FileHandle | null,
  saved: '',
  errorLine: null as number | null,
  zoom: 1,
  size: { width: 0, height: 0 },
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
  const text = source.value;
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
  renderGutter();
  fileName.textContent = state.name;
  fileName.classList.toggle('dirty', text !== state.saved);
  storage(() => localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: state.name, text })));
}

function renderGutter(): void {
  const count = source.value.split('\n').length;
  gutter.innerHTML = Array.from({ length: count }, (_, i) =>
    i + 1 === state.errorLine ? `<span class="bad">${i + 1}</span>` : String(i + 1),
  ).join('\n');
  gutter.scrollTop = source.scrollTop;
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

// --- editing -----------------------------------------------------------------

function goToLine(line: number): void {
  const lines = source.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  source.focus();
  source.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 20;
  source.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

/** Inserts text at the cursor, keeping the browser's undo history where possible. */
function insert(text: string): void {
  if (!document.execCommand('insertText', false, text)) {
    source.setRangeText(text, source.selectionStart, source.selectionEnd, 'end');
    scheduleRender();
  }
}

source.addEventListener('input', scheduleRender);
source.addEventListener('scroll', () => (gutter.scrollTop = source.scrollTop));
source.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    insert('  ');
  } else if (e.key === 'Enter' && !e.isComposing) {
    // Keep the indentation of the current line.
    const before = source.value.slice(0, source.selectionStart);
    const indent = before.slice(before.lastIndexOf('\n') + 1).match(/^ */)![0];
    e.preventDefault();
    insert('\n' + indent);
  }
});

board.addEventListener('click', (e) => {
  const g = (e.target as Element).closest('[data-line]');
  if (g) goToLine(Number(g.getAttribute('data-line')));
});

errorBar.addEventListener('click', () => {
  if (state.errorLine) goToLine(state.errorLine);
});

// --- files -------------------------------------------------------------------

function load(text: string, name: string, handle: FileHandle | null, saved = text): void {
  source.value = text;
  state.name = name;
  state.handle = handle;
  state.saved = saved;
  renderBoard();
}

function confirmDiscard(): boolean {
  return source.value === state.saved || confirm('Discard unsaved changes?');
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
  await w.write(source.value);
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
    download(state.name, source.value, 'text/plain');
  }
  state.saved = source.value;
  renderBoard();
}

async function save(): Promise<void> {
  if (!state.handle) return saveAs();
  await writeTo(state.handle);
  state.saved = source.value;
  renderBoard();
}

function exportSvg(): void {
  try {
    download(state.name.replace(/\.estorm$/, '') + '.svg', svg(layout(parse(source.value))) + '\n', 'image/svg+xml');
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
  if (source.value !== state.saved && state.handle) e.preventDefault();
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
