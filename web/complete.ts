/**
 * Autocompletion in the source editor. Suggestions come from the language
 * server's completions (src/lsp.ts), so the browser offers what VS Code and
 * Neovim do: events, aggregates, externals and actors already on the board,
 * and keywords at the start of a line. Enter or Tab accepts, Esc closes the
 * list and Ctrl-Space (Alt-I or Alt-` on a Mac) opens it.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  insertCompletionText,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { Kind } from '../src/layout.ts';
import { completions } from '../src/lsp.ts';
import { COLORS } from '../src/svg.ts';

/** The suggestions at the cursor, or null when there are none. */
export function suggest({ state, pos }: CompletionContext): CompletionResult | null {
  const line = state.doc.lineAt(pos);
  const cursor = { line: line.number - 1, character: pos - line.from };
  const items = completions(state.doc.toString(), cursor);
  if (!items.length) return null;
  // Every item replaces the same range: the whole name typed so far.
  const from = line.from + items[0]!.textEdit.range.start.character;
  // A name typed in full needs no list, so that Enter starts a new line.
  const typed = state.sliceDoc(from, pos);
  if (items.some((c) => c.textEdit.newText === typed)) return null;
  const options = items.map((c): Completion => {
    // How far the edit reaches past the cursor: over a closing bracket.
    const past = c.textEdit.range.end.character - cursor.character;
    return {
      label: c.textEdit.newText,
      detail: c.detail,
      type: c.detail,
      apply: (view, _, from, to) =>
        view.dispatch(insertCompletionText(view.state, c.textEdit.newText, from, to + past)),
    };
  });
  return { from, options };
}

/** A square in the colour of the sticky a suggestion names; blank for keywords. */
function swatch(c: Completion): Node {
  const el = document.createElement('span');
  el.className = 'cm-completionSwatch';
  const color = COLORS[c.type as Kind];
  if (color) el.style.background = color;
  else el.classList.add('none');
  return el;
}

/**
 * Suggestions as you type, matched by how they start rather than fuzzily, so
 * that a new name rarely brings up a list for Enter to accept.
 */
export const autocomplete: Extension = autocompletion({
  override: [suggest],
  filterStrict: true,
  icons: false,
  addToOptions: [{ render: swatch, position: 20 }],
});
