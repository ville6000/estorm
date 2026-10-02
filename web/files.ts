/**
 * Opening, saving and downloading files. Uses the File System Access API
 * where there is one (Chromium), so Save writes back to the opened file;
 * elsewhere, opening takes a file input and saving downloads.
 */

export interface FileHandle {
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

export const canPick = () => window.showOpenFilePicker !== undefined && window.showSaveFilePicker !== undefined;

/** F's result, or null if the user cancelled the picker. */
async function unlessCancelled<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

/** A file the user picks, with its text, or null if they cancelled. Needs canPick(). */
export async function pickFile(): Promise<{ handle: FileHandle; text: string } | null> {
  const [handle] = (await unlessCancelled(() => window.showOpenFilePicker!({ types: PICKER_TYPES }))) ?? [];
  return handle ? { handle, text: await (await handle.getFile()).text() } : null;
}

/** A file the user picks to save to, or null if they cancelled. Needs canPick(). */
export function pickSaveFile(suggestedName: string): Promise<FileHandle | null> {
  return unlessCancelled(() => window.showSaveFilePicker!({ suggestedName, types: PICKER_TYPES }));
}

export async function writeTo(handle: FileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

export function download(name: string, data: string | Blob, type: string): void {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Safari refuses canvases over 16,777,216 pixels; every browser over 16,384 per side.
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_SIDE = 16_384;

/** SVG drawn on a canvas at twice its size, or less if the board is too big, as PNG. */
export async function svgToPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
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
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}
