/**
 * A stand-in editor for index.html: a host that renders a text box with
 * estorm and sends the result to the page, the way the VS Code and JetBrains
 * hosts do. `npm run dev`, then open /embed/.
 */
import type { ToPage } from '../../src/embed.ts';
import { layout, parseAll, svg } from '../../src/index.ts';

const EXAMPLE = `== Sales ==
{Shopping cart}
Customer: Place order -> (Order) -> OrderPlaced
  after 30 minutes unless PaymentCaptured
    then Cancel unpaid order -> (Order) -> OrderCancelled

== Payments ==
when OrderPlaced
  then Charge card -> [Payment provider] -> PaymentCaptured
  ! What if the charge succeeds but our callback times out?
`;

const editor = Object.assign(document.createElement('textarea'), { value: EXAMPLE, spellcheck: false });
editor.style.cssText = 'position:fixed;left:8px;bottom:8px;width:360px;height:200px;z-index:1;font:12px monospace';

const send = (msg: ToPage) => window.postMessage(msg, '*');

function update(): void {
  const { board, errors } = parseAll(editor.value);
  if (errors.length) send({ type: 'errors', errors: errors.map(({ line, message }) => ({ line, message })) });
  else send({ type: 'render', svg: svg(layout(board)) });
}

window.estormHost = {
  post(msg) {
    console.log('page ->', msg);
    if (msg.type === 'ready') update();
    if (msg.type === 'reveal') {
      const lines = editor.value.split('\n');
      const from = lines.slice(0, msg.line - 1).join('\n').length + (msg.line > 1 ? 1 : 0);
      editor.focus();
      editor.setSelectionRange(from, from + (lines[msg.line - 1]?.length ?? 0));
    }
  },
};

document.addEventListener('DOMContentLoaded', () => document.body.append(editor));
editor.addEventListener('input', update);
