/** HTML for the editor's panels, built from strings; everything from the board is escaped. */
import type { ParseError, Warning } from '../src/index.ts';

export const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A button that jumps to LINE of the source. */
const lineButton = (line: number, message: string) =>
  `<button type="button" data-line="${line}">line ${line}: ${escape(message)}</button>`;

/** The summary's Markdown (headings, bullets, paragraphs) as HTML. */
export function summaryHtml(markdown: string): string {
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

/** Parse errors as buttons that jump to their lines. */
export function errorsHtml(errors: ParseError[]): string {
  return errors.map((e) => lineButton(e.line, e.message)).join('');
}

/** Lint warnings as a heading and a list of buttons that jump to their lines. */
export function warningsHtml(warnings: Warning[]): string {
  if (!warnings.length) return '';
  const items = warnings.map((w) => `<li>${lineButton(w.line, w.message)}</li>`).join('');
  return `<h3>Warnings (${warnings.length})</h3><ul>${items}</ul>`;
}
