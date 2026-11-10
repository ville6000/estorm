# Editor support

`estorm lsp` is a language server (stdio) for any editor that speaks LSP:
it colours each part of a line like the sticky it becomes, shows parse
errors as you type, highlights every mention of the event under the
cursor, and completes keywords and the events, aggregates, externals and
actors already on the board.

Go to definition jumps from an event, say in a `when` or `unless`, to the
steps that produce it. Rename changes an event, aggregate, external or
actor everywhere on the board, including in `when` and `unless`, but not in
hotspots, rules or comments. It refuses a name that would break a line or
change what it means, such as one with `->` or brackets.

Token types are named after the stickies: `actor`, `command`, `aggregate`,
`external`, `event`, `readModel`, `schedule`, `hotspot`, `rule` and `section`, plus
the standard `comment`, `keyword` and `operator`. Most themes colour only
the standard ones, so give the others colours yourself.

The server comes with the command line. Install it once, and it then
works offline:

```sh
npm install -g @villev/estorm
```

## VS Code

Install [estorm for VS Code](https://marketplace.visualstudio.com/items?itemName=villev.estorm)
from the Marketplace, or run `ext install villev.estorm` in Quick Open. It
bundles the server, so the command line isn't needed, and adds a live
preview of the board. Its
[README](https://github.com/ville6000/estorm-vscode#readme) covers colours
and settings.

## JetBrains IDEs

[estorm for JetBrains IDEs](https://github.com/ville6000/estorm-jetbrains)
works in IntelliJ IDEA, WebStorm, Rider, PyCharm and the other JetBrains
IDEs from 2026.2, but not in Android Studio. It colours the text itself and
adds a live preview of the board. Errors, highlights, completion, go to
definition and rename come from the server it bundles, which runs on
Node.js 20 or later. Its
[README](https://github.com/ville6000/estorm-jetbrains#readme) covers
colours and settings.

## Neovim

Neovim 0.11 or later:

```lua
vim.filetype.add({ extension = { estorm = 'estorm' } })
vim.lsp.config('estorm', { cmd = { 'estorm', 'lsp' }, filetypes = { 'estorm' } })
vim.lsp.enable('estorm')

-- Colours like the browser editor's.
for type, hl in pairs({
  command = { fg = '#1864ab' },
  event = { fg = '#a33b0b', bg = '#ffe8cc' },
  schedule = { fg = '#6741d9' },
  external = { italic = true },
  hotspot = { fg = '#c92a2a' },
  rule = { fg = '#946800' },
  section = { bold = true },
}) do
  vim.api.nvim_set_hl(0, '@lsp.type.' .. type .. '.estorm', hl)
end
```

These colours suit a light background. To follow your colorscheme instead,
link each type to one of its groups, such as `{ link = 'Constant' }`, and
set them again on `ColorScheme`, which clears them.

Neovim maps rename to `grn`, and `Ctrl-]` goes to the definition.

Neovim doesn't ask for event highlights on its own. To highlight every
mention of the event when the cursor rests on one:

```lua
vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
  pattern = '*.estorm',
  callback = vim.lsp.buf.document_highlight,
})
vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
  pattern = '*.estorm',
  callback = vim.lsp.buf.clear_references,
})
```

They use the `LspReferenceText` highlight group. `CursorHold` fires after
`updatetime` milliseconds, 4000 by default; `vim.o.updatetime = 250` makes
it feel immediate.

## Other editors

Any editor with an LSP client can run the server: start
`estorm lsp` for files ending in `.estorm`, talking over stdio. The
colours need a client that supports semantic tokens.

## Embedding the server

An editor extension can bundle the server instead of running the `estorm`
command. `@villev/estorm/lsp` exports it:

```ts
import { serveStdio } from '@villev/estorm/lsp';

serveStdio(); // the same server as `estorm lsp`, over stdio
```

Unlike `estorm lsp`, it ignores command-line arguments, so LSP clients that
add `--stdio` or `--clientProcessId` can start it directly. `createServer`
is the protocol without the transport, and `TOKEN_TYPES` is the semantic
token legend.

## Embedding the preview

The VS Code and JetBrains plugins show the board with the same page,
`dist/embed/preview.js` and `preview.css` in the package
(`@villev/estorm/embed/preview.js` and `@villev/estorm/embed/preview.css`).
It draws the board it is sent, keeps the last good board (dimmed) under a
list of errors while the text doesn't parse, pans (drag) and zooms (toolbar,
Ctrl/Cmd + wheel or pinch; clicking a section's name fits it), and asks the
editor to show a sticky's line when it is clicked. The editor parses and
renders; the page never sees the text. It uses no editor API and makes no
network requests.

The page builds its own DOM, so the host's HTML only loads the two files and
defines `window.estormHost` before `preview.js` runs:

```html
<link rel="stylesheet" href="preview.css" />
<script>
  window.estormHost = {
    post(msg) {
      /* to the editor */
    },
    setState(state) {
      /* optional */
    },
  };
</script>
<script src="preview.js"></script>
```

The messages, typed in `@villev/estorm/embed`:

Editor → page, with `window.postMessage(msg, '*')`:

| Message                                                           | Meaning                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `{ type: 'render', svg: string }`                                 | New board, from `svg()`; clears the errors                                             |
| `{ type: 'errors', errors: { line: number, message: string }[] }` | Every error from `parseAll()`, line 0 if not tied to one; the last board stays, dimmed |
| `{ type: 'state', state: unknown }`                               | Passed to `estormHost.setState`, for restoring later                                   |

Page → editor, through `window.estormHost.post(msg)`:

| Message                            | Meaning                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `{ type: 'ready' }`                | Listening; send the board. Sent again after a page reload. |
| `{ type: 'reveal', line: number }` | A sticky, lane or error was clicked; 1-based line          |

The board has the colours of the theme `svg()` was given. The page around it
follows VS Code's theme variables, or light colours without them; another
host can set `--bg`, `--fg`, `--font`, `--button-bg`, `--button-fg`,
`--button-hover`, `--border`, `--focus`, `--error-bg`, `--error-fg` and
`--error-border` in a style after `preview.css`.

To work on the page, `npm run dev` and open `/embed/`: `web/embed/dev.ts`
plays the editor with a text box.
