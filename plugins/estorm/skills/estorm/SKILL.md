---
name: estorm
description: Write, check, render and refine Event Storming boards in estorm's plain-text notation (.estorm files), and transcribe photos of Event Storming workshop walls into them. Use when the user mentions estorm or .estorm files, wants an Event Storming board of domain events, commands, aggregates and policies drawn or kept in the repository, or shares a photo of a sticky-note wall from a workshop.
---

# estorm boards

estorm turns a few readable lines per flow into an Event Storming board,
rendered as SVG. Its notation is its own, so don't write a board from
memory or guess at the syntax.

## 1. Read the guide

Print the guide of the estorm version the project uses, and follow it:

- `npx estorm guide` when the project has estorm installed (`@villev/estorm`
  in package.json),
- otherwise `npx @villev/estorm guide`, which downloads it on first use.

The guide has the notation, the rules and mistakes to avoid, worked
examples, and how to transcribe a workshop. Use the same command prefix for
the steps below.

## 2. Write, check, fix

1. Write or edit the `.estorm` file. If the project already has boards,
   follow their location and style; otherwise ask, suggesting `docs/`.
2. Run `estorm lint --format json <file>`. Each problem has a `line`, a
   stable `code` and a `hint`. Fix every `error` and run it again until none
   are left: a board with errors doesn't render.
3. Warnings are advice about the model, not syntax. Fix them on a board you
   are designing; on a board that records a workshop, list them for the
   user instead of renaming things yourself.
4. Run `estorm render <file>` to write `<file>.svg` (`-t` for the timeline
   view, `<file>.timeline.svg`), and tell the user where it went. If the
   repository keeps rendered SVGs next to its boards, render again after
   every change.

## 3. Transcribing a photo of a workshop

Follow "Transcribing a workshop" in the guide. Above all: record what is on
the wall rather than improving it, keep every sticky's wording, and mark a
sticky you can't read as `! Unclear sticky: "…"?` in its place. If colours
are ambiguous and the photo shows no legend, ask for the legend before
writing. Afterwards, tell the user which stickies were unclear and list the
lint warnings as questions for the people who were there.

## 4. Questions about a board

`estorm summary <file>` lists actors, aggregates, dependencies between
contexts, events nothing reacts to and every hotspot: use it to answer
questions about a board, or to suggest what to ask in the next session.
