# Contributing

Thanks for helping! Bug reports, examples and notation ideas are as welcome
as code.

## Getting started

You need Node.js 22.18 or later (see `.nvmrc`).

```sh
npm install
npm run check   # typecheck and tests; run before every pull request
npm run dev     # the browser editor, reloading as you change the code
```

## How the code is organised

estorm is a small pipeline. Each step is a pure function in its own file:

| File                | Does                                                         |
| ------------------- | ------------------------------------------------------------ |
| `src/parser.ts`     | text to AST, with `ParseError` carrying the line number      |
| `src/layout.ts`     | AST to positioned stickies, arrows, lanes                    |
| `src/svg.ts`        | layout to an SVG string                                      |
| `src/index.ts`      | public API: `parse`, `layout`, `svg`, `render`               |
| `src/cli.ts`        | `estorm render / check / serve`                              |
| `web/`              | the browser editor, built into one file, `estorm.html`       |
| `examples/`         | example boards and their rendered SVGs                       |

The source runs directly on Node.js (type stripping), so there is no build
step while developing: `npm run estorm -- render board.estorm`. Keep to
syntax that can be stripped: no enums, namespaces or parameter properties
(the `erasableSyntaxOnly` option enforces this).

The CLI and the library have no runtime dependencies, and the editor makes
no network requests. Keep it that way: teams use estorm in offline
environments.

## Changing the notation

The notation is the product. Before writing code for new syntax, open an
issue with:

- the Event Storming situation you want to show,
- a proposed `.estorm` snippet,
- how it should look on the board.

A notation change then needs, in the same pull request:

1. GRAMMAR.md updated: the statement, the EBNF, the AST and any new errors.
2. Parser tests for the new syntax and each new error message.
3. Layout tests if it changes placement.
4. If it is worth showing, an example in `examples/`.

## Visual changes

`examples/*.svg` are golden files: the tests fail if rendering changes. When
a change is intended, run `npm run examples`, open the SVGs and review the
diff before committing them.

## Pull requests

- Keep each pull request to one change, with tests.
- Add a line to CHANGELOG.md under "Unreleased".
- `npm run check` must pass.

## Releasing

1. Move the "Unreleased" entries in CHANGELOG.md under the new version.
2. Bump `version` in package.json.
3. Tag `vX.Y.Z` and push the tag. The release workflow builds and attaches
   `estorm.html`.
