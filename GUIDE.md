# Writing estorm boards

A short guide to estorm's notation, for AI models and people new to it:
enough to write a board that checks clean and reads well. `estorm guide`
prints it. The full specification, with every error and warning, is
[GRAMMAR.md](GRAMMAR.md).

An estorm board is a plain-text `.estorm` file, one statement per line,
rendered as an Event Storming board of stickies. Time runs down the file
and left to right on the board.

## Workflow

1. Write or edit the `.estorm` file.
2. Check it with `estorm lint --format json board.estorm`. Fix every error,
   following its `hint`, and check again until none are left: a board with
   errors doesn't render. Warnings are advice about the model, not syntax.
3. Render it: `estorm render board.estorm` writes `board.svg`, and
   `estorm render -t board.estorm` the timeline view, `board.timeline.svg`.
4. `estorm summary board.estorm` lists actors, aggregates, dependencies
   between contexts, events nothing reacts to and hotspots.

Run estorm as `npx estorm` when the project has it installed, or else as
`npx @villev/estorm`, which downloads it on first use.

## Notation

| Write                                    | Sticky                                                  |
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

A Big Picture board, early on: events in the order they happen, causes not
known yet.

```estorm
== Sales ==
ProductViewed
ItemAddedToCart
OrderPlaced
! Can a customer change an order after placing it?

== Warehouse ==
OrderPicked
OrderShipped
! Who handles damaged parcels?
```

A design-level board, with causes, policies and contexts reacting to each
other:

```estorm
== Sales ==
{Shopping cart}
Customer: Place order -> (Order) -> OrderPlaced
  * An order has at least one item
  after 30 minutes unless PaymentCaptured
    then Cancel unpaid order -> (Order) -> OrderCancelled

== Payments ==
when OrderPlaced
  then Charge card -> [Payment provider] -> PaymentCaptured, PaymentFailed
  ! What if the charge succeeds but our callback times out?

when PaymentFailed
  then Notify customer -> [Email] -> CustomerNotified

== Shipping ==
every night at 02:00: Batch shipments -> (Shipment) -> ShipmentsBatched
```

## Rules

- Indent with two spaces per level, never tabs. Flows, events, schedules,
  `when` and sections start at column 0.
- `then` and `after` go exactly one level deeper than the flow, event,
  reaction or `when` they react to. The `then` lines under an `after` go
  one level deeper still.
- A chain is one command, then any `(Aggregate)` and `[External]` items,
  then the event, last. Nothing else is a bare name: a follow-up step is a
  new `then` line, not another `->`.
- A command with several outcomes lists them with commas:
  `Pay -> PaymentCaptured, PaymentFailed`. Such a step can't take `then` or
  `after`: react to one of its events with `when` at column 0.
- Names can't contain `(` `)` `[` `]` `{` `}` `:` or `->`. Avoid commas in
  names, too.
- `when` and `unless` name an event produced somewhere in the file, before
  or after, spelled exactly the same. Spell every event, aggregate and actor
  the same way everywhere.
- `{Read model}` goes on its own line, directly above the flow or `then` it
  informs.
- `! Hotspot` and `* Rule` belong to the nearest step above them; indent
  them under it for readability. A hotspot at the top of the file, or right
  after a section header, is about the whole board or section. A rule's step
  needs exactly one `(Aggregate)`.
- Events are facts in the past tense (`OrderPlaced` or `Order placed`);
  commands are imperative (`Place order`). Pick one naming style per board.

## Common mistakes

Each mistake below is an error; the fix follows it. In JSON, every error has
a stable `code` and a `hint` on how to fix it.

A follow-up step chained onto the event
(`expected-aggregate-or-external`):

```text
Customer: Place order -> OrderPlaced -> PaymentCaptured
```

```estorm
Customer: Place order -> OrderPlaced
  then Capture payment -> [Payment provider] -> PaymentCaptured
```

A policy without a command (`chain-without-event`):

```text
OrderPlaced
  then PaymentCaptured
```

```estorm
OrderPlaced
  then Capture payment -> PaymentCaptured
```

An aggregate or external system on its own line (`unrecognised-line`):

```text
(Order)
Customer: Place order -> OrderPlaced
```

```estorm
Customer: Place order -> (Order) -> OrderPlaced
```

A policy under a step with several events
(`reaction-after-several-events`):

```text
Customer: Pay -> PaymentCaptured, PaymentFailed
  then Notify customer -> CustomerNotified
```

```estorm
Customer: Pay -> PaymentCaptured, PaymentFailed

when PaymentFailed
  then Notify customer -> CustomerNotified
```

Four spaces instead of two (`indent-too-deep`):

```text
Customer: Place order -> OrderPlaced
    then Send confirmation -> ConfirmationSent
```

```estorm
Customer: Place order -> OrderPlaced
  then Send confirmation -> ConfirmationSent
```

A read model after the step it informs (`dangling-read-model`):

```text
Customer: Place order -> OrderPlaced
{Shopping cart}
```

```estorm
{Shopping cart}
Customer: Place order -> OrderPlaced
```

## Transcribing a workshop

From a photo of a wall, or a whiteboard export: record what the workshop
produced, and don't improve on it.

- Keep the wording of every sticky, even where lint warns. Don't add actors,
  commands, aggregates or links that aren't on the wall. Report the
  warnings to the user instead: they are questions for the people who were
  there.
- Read the wall left to right. A Big Picture wall, mostly orange events,
  becomes a run of events, one per line, in wall order; stickies stacked in
  one column go top to bottom.
- Swimlanes, or areas labelled with a context or team, become
  `== Name ==` sections.
- Only where the wall has them, write actors, commands, aggregates,
  external systems, read models and policies as flows and `then` lines,
  following the wall's arrows or its order.
- Use the colour legend on the wall, or the one the user gives. Without
  one, the usual colours are: orange event, blue command, small yellow
  actor, large pale yellow aggregate, lilac policy, green read model, wide
  pink external system, and a bright pink or red sticky, often turned 45°,
  for a hotspot. Ask when two colours could be confused.
- A hotspot goes right after the event it sits next to:
  `! Who approves refunds?`
- A sticky you can't read keeps its place as a hotspot:
  `! Unclear sticky: "Ordr cnfrmd"?`
- A long wall in several photos: they come left to right in the order
  given, and overlap. Write a sticky seen in two photos once.
- When done, check the board and fix syntax errors only. Then tell the user
  which stickies were unclear, and list the lint warnings.

## Refining a board

- Give an event its cause once it's known: `OrderPlaced` becomes
  `Customer: Place order -> (Order) -> OrderPlaced`, keeping the lines
  under it.
- Add policies with `then`, delays with `after … unless …`, schedules with
  `every …:`, and `when` for reactions across contexts.
- `estorm summary` lists events nothing reacts to and every hotspot: good
  questions for the next session.
- On a board that records a workshop, suggest renames (past tense, one
  aggregate per context) rather than making them.
