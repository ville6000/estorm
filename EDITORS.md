# Editor support

`estorm lsp` is a language server (stdio) for any editor that speaks LSP:
it colours each part of a line like the sticky it becomes, shows parse
errors as you type, and highlights every mention of the event under the
cursor.

Token types are named after the stickies: `actor`, `command`, `aggregate`,
`external`, `event`, `readModel`, `schedule`, `hotspot` and `section`, plus
the standard `comment`, `keyword` and `operator`. Most themes colour only
the standard ones, so give the others colours yourself.

## Neovim

Neovim 0.11 or later:

```lua
vim.filetype.add({ extension = { estorm = 'estorm' } })
vim.lsp.config('estorm', { cmd = { 'npx', 'estorm', 'lsp' }, filetypes = { 'estorm' } })
vim.lsp.enable('estorm')

-- Colours like the browser editor's.
for type, hl in pairs({
  command = { fg = '#1864ab' },
  event = { fg = '#a33b0b', bg = '#ffe8cc' },
  schedule = { fg = '#6741d9' },
  external = { italic = true },
  hotspot = { fg = '#c92a2a' },
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
