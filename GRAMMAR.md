# estorm notation

Plain text, one statement per line. Files use the `.estorm` extension.

## Example

```
# Ticket handling
{Ticket form with topic list}
Customer: Submit ticket -> (Ticket) -> TicketSubmitted
  then Fetch customer details -> [CRM] -> CustomerDetailsFetched
  {Department topic mapping}
  then Assign by topic -> (Ticket) -> TicketAssigned
  ! Who owns the topic → department mapping?
```

## Sticky types

| Syntax                                     | Sticky              | Colour               |
| ------------------------------------------ | ------------------- | -------------------- |
| `Actor:`                                   | actor               | pale yellow          |
| first chain item                           | command             | blue                 |
| `then`                                     | policy              | lilac                |
| `after … then`                             | delayed policy (⏰) | lilac                |
| `every …:`                                 | schedule (⏰)       | pale lilac           |
| `(Name)`                                   | aggregate           | yellow               |
| `[Name]`                                   | external system     | pink                 |
| `{Name}`                                   | read model          | green                |
| last chain item, or a name on its own line | event               | orange               |
| `! text`                                   | hotspot             | red                  |
| `* text`                                   | rule, in aggregate  | (aggregate's yellow) |
| `== Name ==`                               | section (lane)      | own panel            |

## Statements

**Flow** — an actor issues a command, producing an event. Read models, the
actor (or policy) and the command touch, as one group; arrows start at the
command.

```
Actor: Command -> Event
Actor: Command -> (Aggregate) -> Event
Actor: Command -> [External] -> Event
```

The actor is optional, for when it isn't known yet; the row then starts at
the command (or its read models).

```
Command -> Event
```

A command may produce several events, separated by commas: facts recorded
at once, or possible outcomes, as stickies stacked on a wall. They stack in
one column, an arrow forking to each. A step with several events can't take
`then` or `after`: name the event with `when` instead. Hotspots and rules
still follow it.

```
Agent: Reply -> (Ticket) -> TicketReplied, TicketCompleted
every 5 minutes: Close stale -> (Ticket) -> TicketClosed, TicketCloseDeferred

when TicketCloseDeferred
  then Notify agent -> [Email] -> AgentNotified
```

**Reaction** — a policy reacts to the event of the nearest less-indented
flow or reaction above it, and issues a command. The policy sticky is labelled
`whenever <trigger event>`.

```
  then Command -> Event
  then Command -> [External] -> (Aggregate) -> Event
```

**After** — delays the `then` reactions under it: they happen DURATION
after the parent's event, unless the `unless` event happens first. Like a
`then`, it is one level deeper than its parent (a flow, reaction or `when`),
and its reactions one level deeper still. DURATION is free text. The
`unless …` part is optional. When given, its event must be produced
somewhere in the file; a red dotted arrow links it to the delayed policies.

```
  after 30 days unless CustomerFollowedUp
    then Close ticket -> (Ticket) -> TicketClosed
```

**Schedule** — a flow driven by time instead of an actor. SCHEDULE is free
text and may contain colons, as in a time; the last colon on the line ends
it, since the names after it have none.

```
every night at 02:00: Command -> Event
```

**When** — reacts to an event by name instead of by indentation, usually
one from another section (bounded context). Its `then` reactions are indented
one level. The event may be produced anywhere in the file, before or after.
The policies are linked to that event by a dashed arrow. In the event's own
section they start under the event; in another section, right of it, on the
next free row of that section. What comes after a `when` in its section
starts no further left, if its event is earlier in the file.

A `when` may name several events, separated by commas: one policy reacts to
any of them, labelled `whenever A, B or C`, with a dashed arrow from each.
It starts at the latest of them, as above for each event.

```
when Event
  then Command -> Event

when EventA, EventB, EventC
  then Command -> Event
```

**Event** — a name on its own line: an event whose cause isn't known yet,
as in the first, chaotic phase of Event Storming. Consecutive events form a
timeline, one row left to right, with no arrows between them. Later, turn a
line into a flow by adding its actor and command. Like the event of a flow,
it can take hotspots and `then` reactions (which end its row), and `when` and
`unless` can name it.

```
OrderPlaced
PaymentCaptured
! What if payment fails?
OrderShipped
```

**Section** — starts a bounded context. Everything below, up to the next
section, belongs to it, and is drawn in its own horizontal swimlane. All
lanes share one time axis, left to right; they stack top to bottom in order
of first appearance, and rows stack inside each lane. Content before the
first section goes in an unnamed lane on top. A section may appear more than
once; later parts continue its lane.

```
== Name ==
```

**Read model** — informs the next flow or reaction (same or deeper indent).

```
{Name}
```

**Hotspot** — a question or problem, caused by the nearest flow, reaction or
event above it in the same section. Hotspots before the first flow belong to the
whole board; right after a section header, to that section. A hotspot
directly after `when` or `after` is an error.
Indentation doesn't change the cause; indent under the step for readability.

```
! text
```

**Rule** — a business rule (invariant) the aggregate of the nearest flow or
reaction above enforces, such as "a room is never double-booked". It is
listed under the aggregate's name, in that row's aggregate sticky, which
grows to fit. Like a hotspot, indentation doesn't change which step it
belongs to; indent under the step for readability. The step must have
exactly one `(Aggregate)`.

```
Guest: Book room -> (Booking) -> RoomBooked
  * A room is never double-booked
```

**Comment / blank** — ignored.

```
# text
```

## Chains

After the command, items are separated by `->`:

- zero or more `(Aggregate)` / `[External]` items, in any order
- exactly one bare item, which must be last: the **event**, or several
  events separated by commas

Commas are allowed in the name of an event on its own line, but not at the
end of a chain, nor in `when`.

Whitespace around `->` is ignored. Item text is trimmed and may contain spaces.

## Indentation

- Indent with spaces only, 2 per level. Tabs are an error.
- Flows, schedules, events, `when` and sections start at column 0.
- An `after` line follows the same rules as `then`.
- A `then` line must be exactly one level deeper than its parent.

## Grammar (EBNF)

```ebnf
document   = { line , newline } ;
line       = blank | comment | hotspot | rule | read-model | flow | reaction
           | when | after | schedule | section | event ;

blank      = { " " } ;
comment    = indent , "#" , text ;
hotspot    = indent , "!" , text ;
rule       = indent , "*" , text ;
read-model = indent , "{" , name , "}" ;
flow       = [ name , ":" ] , name , chain ;
reaction   = indent , "then" , " " , name , chain ;
when       = "when" , " " , name , { "," , name } ;
after      = indent , "after" , " " , text , [ " unless " , name ] ;
schedule   = "every" , " " , text , ":" , name , chain ;
section    = "==" , text , "==" ;
event      = name ;

chain      = { arrow , ( aggregate | external ) } , arrow , name , { "," , name } ;
arrow      = "->" ;
aggregate  = "(" , name , ")" ;
external   = "[" , name , "]" ;

indent     = { "  " } ;
name       = text without "->" "(" ")" "[" "]" "{" "}" ":" ;
text       = any characters up to end of line ;
```

## AST

`parse()` returns the top-level items in source order. Line numbers are
1-based, for error messages and editor features (clicking a sticky jumps to
its line). See `src/parser.ts` for the types. For the example above:

```json
[
  {
    "type": "flow",
    "line": 3,
    "informedBy": [{ "type": "read-model", "name": "Ticket form with topic list", "line": 2 }],
    "actor": "Customer",
    "command": "Submit ticket",
    "via": [{ "type": "aggregate", "name": "Ticket" }],
    "events": ["TicketSubmitted"],
    "hotspots": [],
    "reactions": [
      {
        "type": "reaction",
        "line": 4,
        "informedBy": [],
        "command": "Fetch customer details",
        "via": [{ "type": "external", "name": "CRM" }],
        "events": ["CustomerDetailsFetched"],
        "hotspots": [],
        "reactions": []
      },
      {
        "type": "reaction",
        "line": 6,
        "informedBy": [{ "type": "read-model", "name": "Department topic mapping", "line": 5 }],
        "command": "Assign by topic",
        "via": [{ "type": "aggregate", "name": "Ticket" }],
        "events": ["TicketAssigned"],
        "hotspots": [{ "type": "hotspot", "text": "Who owns the topic → department mapping?", "line": 7 }],
        "reactions": []
      }
    ]
  }
]
```

`events` lists the events of a flow or reaction, in order; one, or several
from `A, B`.

Read models are moved into `informedBy` of the statement they precede.
A read model with no following flow or reaction is an error.

Rules go into `rules` of their flow or reaction
(`{ "type": "rule", "text": "...", "line": 8 }`), empty when there are none;
the examples above leave the empty ones out.

Hotspots go into `hotspots` of the flow or reaction that caused them. Board
and section hotspots are top-level, in source order with the flows.

An `after` sits in its parent's `reactions`, holding the reactions it
delays. A schedule is a flow with `schedule` instead of `actor`:

```json
{ "type": "after", "line": 10, "duration": "30 days", "unless": "CustomerFollowedUp", "reactions": [ ... ] }
{ "type": "flow", "line": 19, "schedule": "night at 02:00", "command": "Archive tickets", ... }
```

Sections are top-level markers; an item belongs to the nearest section above.
A `when` takes its reactions; `events` lists the events it names, in order:

```json
[
  { "type": "section", "name": "Sales", "line": 1 },
  { "type": "flow", "line": 2, "events": ["OrderPlaced"], ... },
  { "type": "section", "name": "Billing", "line": 3 },
  { "type": "when", "line": 4, "events": ["OrderPlaced"], "reactions": [ ... ] }
]
```

## Timeline view

`estorm render --timeline`, and the Timeline button in the browser editor,
draw only the events, on one time axis left to right for the whole board.
Sections are horizontal swimlanes, top to bottom in order of first
appearance. An event produced more than once is drawn once, in the section
of its first producer.

An event's column is the longest chain of causes before it: a reaction's
event comes after the event it reacts to (also through `after` and `when`;
after each of them for a `when` on several),
and an event in a run comes after the one before it. Several events of one
step share its column. Within a section, a
flow, run or `when` is never left of the one above it. Events of a section
in the same column stack, in source order. `unless` doesn't affect order.

Arrows link reactions within a section; dashed links follow `when` and
cross sections. Hotspots and the other stickies are left out.

## Errors

Reported as `<file>:<line>: <message>`, e.g.
`board.estorm:4: 'then' has no parent flow`. Parsing stops at the first
error. The messages:

Lines

- `unrecognised line`
- `invalid actor: A(x)`
- `empty hotspot`
- `empty rule`
- `empty section name`

Indentation

- `tab in indentation`
- `indentation must be a multiple of 2 spaces`
- `flow must not be indented` (also for schedules)
- `'when' must not be indented`
- `event must not be indented`
- `section must not be indented`
- `'then' has no parent flow` (also `'after'`)
- `'then' must be one level deeper than its parent` (also `'after'`)

Chains

- `chain must end with an event`
- `chain must end with an event, got [CRM]`
- `expected a command, got (Ticket)`
- `expected (Aggregate) or [External], got TicketSubmitted`
- `empty item in chain`
- `empty event name in chain`
- `chain names TicketClosed twice`
- `invalid item: {Backlog}`

Structure

- `read model {Backlog} informs nothing`
- `rule must follow a flow or reaction`
- `rule needs an (Aggregate) in its step`
- `rule is ambiguous: step has several aggregates`
- `hotspot must follow a flow or reaction, not 'when'` (also `'after'`)
- `'then' can't follow several events; use 'when' with one of them` (also `'after'`)
- `'when' has no reactions` (also `'after'`)
- `'when' expects an event name, got (Ticket)` (also `'unless'`)
- `'when' refers to unknown event TicketSubmited` (once per unknown event)
- `empty event name in 'when'`
- `'when' names TicketClosed twice`
- `'unless' refers to unknown event CustomerFolowedUp`

## Warnings

`estorm lint`, the language server and the browser editor also warn about
boards that parse but model the domain poorly. Warnings never stop a board
from rendering.

- `event should be in the past tense: SubmitTicket`: no word of the event
  name is a past participle. A heuristic: words ending in `-ed` and common
  irregular ones (`Sent`, `Paid`, `Taken`) count.
- `aggregate Ticket is used in several contexts: Support, Billing`: the same
  aggregate appears in more than one section. Reported at its first use in
  the second context.
