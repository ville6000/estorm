# estorm

[![CI](https://github.com/ville6000/estorm/actions/workflows/ci.yml/badge.svg)](https://github.com/ville6000/estorm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@villev/estorm)](https://www.npmjs.com/package/@villev/estorm)

Event Storming boards as plain text. Write the flow in a few readable lines
and get a board of stickies, rendered as SVG.

```
== Sales ==
{Shopping cart}
Customer: Place order -> (Order) -> OrderPlaced
  after 30 minutes unless PaymentCaptured
    then Cancel unpaid order -> (Order) -> OrderCancelled

== Payments ==
when OrderPlaced
  then Charge card -> [Payment provider] -> PaymentCaptured
  ! What if the charge succeeds but our callback times out?
```

![A web shop checkout board rendered by estorm](examples/checkout.svg)

## What it's for

estorm is not a replacement for the workshop. A live session with a dozen
people at a wall works best with paper stickies or a shared whiteboard. Run
the workshop there, then capture the result here.

Text fits what comes after the workshop:

- **Keeping the board.** Boards live in your repository next to the code.
  Changes go through review like any other change, show up as readable
  diffs, and never go stale on a whiteboard photo.
- **Refining it.** Start with the events as they came up, then add actors,
  commands, aggregates and policies as the model firms up.
- **Modelling alone.** Sketch a domain before a workshop, to find the
  questions worth asking the room.

## Which one do you need?

| You want to…                                   | Use                               | Install                       |
| ---------------------------------------------- | --------------------------------- | ----------------------------- |
| Capture a workshop, or model alone             | [Browser editor](#browser-editor) | Nothing: download one file    |
| Render, check or lint boards from the terminal | [Command line](#command-line)     | `npm install -g`, Node.js 22+ |
| Write boards in VS Code                        | [Editor support](#editor-support) | The VS Code extension         |
| Write boards in Neovim or another LSP editor   | [Editor support](#editor-support) | The command line              |
| Render boards in CI                            | [Docker and CI](#docker-and-ci)   | Docker                        |
| Render boards from JavaScript or TypeScript    | [Library](#library)               | `npm install`                 |

Everything works offline once installed: the browser editor makes no
network requests, and the command line and library have no runtime
dependencies.

## Notation at a glance

| Syntax                                   | Sticky                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `Event`                                  | event, cause not known yet; a run of them is a timeline |
| `Actor: Command -> Event`                | actor, command, event (actor optional)                  |
| `-> (Aggregate) ->` / `-> [External] ->` | aggregate / external system                             |
| `Command -> EventA, EventB`              | several events, stacked                                 |
| `{Read model}`                           | read model, informing the next step                     |
| `  then Command -> Event`                | policy reacting to the event above                      |
| `  after 30 days unless Event`           | delayed policy, cancelled by an event                   |
| `every night at 02:00: Command -> Event` | flow driven by a schedule                               |
| `when Event`                             | policy reacting to an event by name                     |
| `== Context ==`                          | bounded context, drawn as a swimlane                    |
| `! Question?`                            | hotspot                                                 |
| `* Rule`                                 | business rule, listed in the aggregate above            |
| `# comment`                              | ignored                                                 |

The full notation, with every rule and error message, is in
[GRAMMAR.md](GRAMMAR.md). More examples are in [examples/](examples/).

## Browser editor

For drawing boards. Edit on the left, see the board on the right, click a
sticky to jump to its line, open and save `.estorm` files, export SVG,
switch to the [timeline view](GRAMMAR.md#timeline-view) and open a summary of lint warnings, actors, aggregates, context
dependencies, gaps and hotspots.

A legend above the board names the sticky colours and arrow styles it uses,
so exported images make sense to people who don't know the notation.

To present a large board, drag it to pan, zoom with Ctrl/⌘ and the wheel or
by pinching, and click a section's name to fit that section to the view.

**Share** copies a link that opens the board for anyone. The board is
compressed into the link's `#` fragment, which browsers never send to a
server, so it is not uploaded anywhere. Links from the downloaded file
point to the hosted editor.

**Try it:** <https://ville6000.github.io/estorm/>, updated on each release.

**Install:** download `estorm.html` from the
[latest release](https://github.com/ville6000/estorm/releases/latest) and
open it in a browser. It is a single self-contained file, so no server is
needed, and it works offline. Drafts are kept in the browser's local
storage.

**Share with a team:** put the file on any static web server, an intranet
page or a file share.

## Command line

For rendering boards to SVG and checking them, locally or in scripts.

**Install:** requires Node.js 22.18 or later. Install once while online;
it then works offline:

```sh
npm install -g @villev/estorm
```

**Use:**

```sh
estorm render board.estorm        # writes board.svg
estorm render docs/*.estorm       # one SVG next to each file
estorm render board.estorm -o -   # SVG to stdout
estorm render -t board.estorm     # timeline view, to board.timeline.svg
estorm render board.estorm --theme auto   # dark when the viewer's is (also: light, dark)
estorm render board.estorm --no-legend     # without the key to sticky colours and arrows
estorm check docs/*.estorm        # errors only, for CI
estorm lint docs/*.estorm         # errors and modelling warnings
estorm summary board.estorm       # actors, aggregates, gaps, hotspots
estorm serve board.estorm         # live preview at http://localhost:8080
```

Errors are reported as `file:line: message`, and the exit code is non-zero.
`lint` also warns about events not named in the past tense and aggregates
used in more than one bounded context; see
[GRAMMAR.md](GRAMMAR.md#warnings).

`serve` redraws the board each time you save the file in your editor. The
page has the browser editor's board without the editor: pan and zoom, fit a
section, the timeline view, the summary with lint warnings, and SVG or PNG
export.

To pin a version per project, use `npm install -D @villev/estorm` and run
`npx estorm`. Running `npx @villev/estorm` without installing also works,
but downloads the package and so needs a connection.

## Editor support

For writing boards in your code editor: sticky colours, every parse error
and lint warning as you type, highlights for the event under the cursor, and
completion of keywords and of the events, aggregates, externals and actors
already on the board.

**VS Code:** install
[estorm for VS Code](https://marketplace.visualstudio.com/items?itemName=villev.estorm)
from the Marketplace. It bundles the language server and adds a live
preview of the board; nothing else to install.

**Other editors:** install the [command line](#command-line); it includes the
language server, `estorm lsp`, for any editor that speaks LSP. Setup for
Neovim is in [EDITORS.md](EDITORS.md).

## Docker and CI

For rendering boards in a pipeline without installing Node.js.

**Install:** build the image from this repository:

```sh
docker build -t estorm .
docker run --rm -v "$PWD:/work" estorm render docs/board.estorm
```

For example, as a GitLab CI job that renders every board:

```yaml
boards:
  image: { name: registry.example.com/estorm:latest, entrypoint: [''] }
  script: estorm render $(find . -name '*.estorm' -not -path './node_modules/*')
  artifacts: { paths: ['**/*.svg'] }
```

**Offline:** push the image to your internal registry, or save it to a file
and load it on the offline machine:

```sh
docker save estorm -o estorm.tar   # online
docker load -i estorm.tar          # offline
```

## Library

For rendering boards from your own code.

**Install:**

```sh
npm install @villev/estorm
```

**Use:**

```ts
import { parse, parseAll, layout, svg, render, renderTimeline, summarize, lint, ParseError } from '@villev/estorm';

const doc = render(text); // parse -> layout -> svg
const dark = render(text, { theme: 'dark' }); // or 'auto': follows prefers-color-scheme
const bare = render(text, { legend: false }); // without the key to sticky colours and arrows
const events = renderTimeline(text); // parse -> timeline -> svg
const prose = summarize(parse(text)); // Markdown overview
const warnings = lint(parse(text)); // [{ line, message }]
const { board, errors } = parseAll(text); // every ParseError, and the board without the broken lines
```

## Development

```sh
npm install
npm run dev        # editor with hot reload
npm run check      # typecheck and tests
npm run build      # dist/ (library and CLI) and dist/web/estorm.html
npm run examples   # re-render examples/*.svg after a visual change
npm run estorm -- render board.estorm   # run the CLI from source
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is organised and
how to propose notation changes.

## License

[MIT](LICENSE)
