/**
 * The source editor: CodeMirror with estorm highlighting, parse errors marked
 * in the gutter, two-space indentation and optional vim keys.
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
import { vim } from '@replit/codemirror-vim';
import { tokenize } from '../src/highlight.ts';

export { Vim } from '@replit/codemirror-vim';

/** Marks the line numbers of the lines with parse errors. */
export const setErrorLines = StateEffect.define<number[]>();
const badLine = new (class extends GutterMarker {
  override elementClass = 'bad';
})();
const errorLineField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    for (const e of tr.effects) {
      if (!e.is(setErrorLines)) continue;
      const lines = [...new Set(e.value)].filter((n) => n <= tr.state.doc.lines);
      return RangeSet.of(
        lines.map((n) => badLine.range(tr.state.doc.line(n).from)),
        true,
      );
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
const vimKeys = (on: boolean) => (on ? vim({ status: true }) : []);

/** An editor state for TEXT, calling ON_CHANGE whenever the text changes. */
export function createState(text: string, { vim, onChange }: { vim: boolean; onChange: () => void }): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      vimMode.of(vimKeys(vim)),
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
        if (u.docChanged) onChange();
      }),
    ],
  });
}

export function setVimKeys(view: EditorView, on: boolean): void {
  view.dispatch({ effects: vimMode.reconfigure(vimKeys(on)) });
}

/** Selects line LINE, scrolls it to the middle and focuses the editor. */
export function goToLine(view: EditorView, line: number): void {
  if (line > view.state.doc.lines) return;
  const { from, to } = view.state.doc.line(line);
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  view.focus();
}
