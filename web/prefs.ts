/**
 * What the editor keeps in local storage. Storage can be missing or throw
 * (private windows, blocked site data), so every access falls back.
 */

const DRAFT_KEY = 'estorm:draft';
const VIM_KEY = 'estorm:vim';
const TIMELINE_KEY = 'estorm:timeline';

export interface Draft {
  name: string;
  text: string;
}

function storage<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

const getFlag = (key: string) => storage(() => localStorage.getItem(key) === '1') ?? false;
const setFlag = (key: string, on: boolean) => storage(() => localStorage.setItem(key, on ? '1' : ''));

export const loadVim = () => getFlag(VIM_KEY);
export const saveVim = (on: boolean) => setFlag(VIM_KEY, on);
export const loadTimeline = () => getFlag(TIMELINE_KEY);
export const saveTimeline = (on: boolean) => setFlag(TIMELINE_KEY, on);

export function loadDraft(): Draft | null {
  const draft = storage(() => JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')) as Draft | null | undefined;
  return draft && typeof draft.text === 'string' ? { name: draft.name || 'untitled.estorm', text: draft.text } : null;
}

export function saveDraft(draft: Draft): void {
  storage(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)));
}
