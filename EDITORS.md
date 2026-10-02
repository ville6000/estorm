# Editor support

`estorm lsp` is a language server (stdio) for any editor that speaks LSP:
it colours each part of a line like the sticky it becomes, shows parse
errors as you type, highlights every mention of the event under the
cursor, and completes keywords and the events, aggregates, externals and
actors already on the board.

Token types are named after the stickies: `actor`, `command`, `aggregate`,
`external`, `event`, `readModel`, `schedule`, `hotspot`, `rule` and `section`, plus
the standard `comment`, `keyword` and `operator`. Most themes colour only
the standard ones, so give the others colours yourself.

The server comes with the command line. Install it once, and it then
works offline:

```sh
npm install -g @villev/estorm
```

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
