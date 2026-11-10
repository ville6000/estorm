/**
 * Messages between the preview page editors embed (web/embed/, built to
 * dist/embed/preview.js and preview.css) and the editor hosting it. The page
 * knows nothing about the editor, so the same build runs in a VS Code webview
 * and in a JetBrains JCEF browser. EDITORS.md describes the page.
 */

/** Editor -> page, delivered with window.postMessage. */
export type ToPage =
  /** A new diagram; replaces the shown one and clears the errors. */
  | { type: 'render'; svg: string }
  /** Every reason the text doesn't render (LINE 0: not tied to a line); the last diagram stays, dimmed. */
  | { type: 'errors'; errors: PreviewError[] }
  /** Opaque state the page keeps for the editor, e.g. to restore after a reload. */
  | { type: 'state'; state: unknown };

export interface PreviewError {
  line: number;
  message: string;
}

/** Page -> editor, through window.estormHost.post. */
export type ToHost =
  /** The page is listening; send the diagram. */
  | { type: 'ready' }
  /** A sticky or lane was clicked: show its 1-based source line. */
  | { type: 'reveal'; line: number };

/** What the editor provides as window.estormHost before the page script runs. */
export interface Host {
  post(msg: ToHost): void;
  /** Keeps state across reloads, where the editor supports it. */
  setState?(state: unknown): void;
}
