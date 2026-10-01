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
| `== Name ==`                               | section (lane)      | white lane, grey gap |

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
text and may contain colons; a colon followed by a space ends it.

```
every night at 02:00: Command -> Event
```

**When** — reacts to an event by name instead of by indentation, usually
one from another section (bounded context). Its `then` reactions are indented
one level. The event may be produced anywhere in the file, before or after.
The policies are linked to that event by a dashed arrow. In the event's own
section they start in its column; in another section, at the section's
first column, level with the event when the lane is free there.

```
when Event
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
section, belongs to it, and is drawn in its own vertical lane. Lanes sit
side by side, left to right, in order of first appearance; rows stack
inside each lane. Content before the first section goes in an unnamed lane
on the left. A section may appear more than once; later parts continue its
lane.

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

**Comment / blank** — ignored.

```
# text
```

## Chains

After the command, items are separated by `->`:

- zero or more `(Aggregate)` / `[External]` items, in any order
- exactly one bare item, which must be last: the **event**

Whitespace around `->` is ignored. Item text is trimmed and may contain spaces.

## Indentation

- Indent with spaces only, 2 per level. Tabs are an error.
- Flows, schedules, events, `when` and sections start at column 0.
- An `after` line follows the same rules as `then`.
- A `then` line must be exactly one level deeper than its parent.

## Grammar (EBNF)

```ebnf
document   = { line , newline } ;
line       = blank | comment | hotspot | read-model | flow | reaction
           | when | after | schedule | section | event ;

blank      = { " " } ;
comment    = indent , "#" , text ;
hotspot    = indent , "!" , text ;
read-model = indent , "{" , name , "}" ;
flow       = [ name , ":" ] , name , chain ;
reaction   = indent , "then" , " " , name , chain ;
when       = "when" , " " , name ;
after      = indent , "after" , " " , text , [ " unless " , name ] ;
schedule   = "every" , " " , text , ": " , name , chain ;
section    = "==" , text , "==" ;
event      = name ;

chain      = { arrow , ( aggregate | external ) } , arrow , name ;
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
    "event": "TicketSubmitted",
    "hotspots": [],
    "reactions": [
      {
        "type": "reaction",
        "line": 4,
        "informedBy": [],
        "command": "Fetch customer details",
        "via": [{ "type": "external", "name": "CRM" }],
        "event": "CustomerDetailsFetched",
        "hotspots": [],
        "reactions": []
      },
      {
        "type": "reaction",
        "line": 6,
        "informedBy": [{ "type": "read-model", "name": "Department topic mapping", "line": 5 }],
        "command": "Assign by topic",
        "via": [{ "type": "aggregate", "name": "Ticket" }],
        "event": "TicketAssigned",
        "hotspots": [{ "type": "hotspot", "text": "Who owns the topic → department mapping?", "line": 7 }],
        "reactions": []
      }
    ]
  }
]
```

Read models are moved into `informedBy` of the statement they precede.
A read model with no following flow or reaction is an error.

Hotspots go into `hotspots` of the flow or reaction that caused them. Board
and section hotspots are top-level, in source order with the flows.

An `after` sits in its parent's `reactions`, holding the reactions it
delays. A schedule is a flow with `schedule` instead of `actor`:

```json
{ "type": "after", "line": 10, "duration": "30 days", "unless": "CustomerFollowedUp", "reactions": [ ... ] }
{ "type": "flow", "line": 19, "schedule": "night at 02:00", "command": "Archive tickets", ... }
```

Sections are top-level markers; an item belongs to the nearest section above.
A `when` takes its reactions:

```json
[
  { "type": "section", "name": "Sales", "line": 1 },
  { "type": "flow", "line": 2, "event": "OrderPlaced", ... },
  { "type": "section", "name": "Billing", "line": 3 },
  { "type": "when", "line": 4, "event": "OrderPlaced", "reactions": [ ... ] }
]
```

## Errors

Reported as `<file>:<line>: <message>`, e.g.
`board.estorm:4: 'then' has no parent flow`. Parsing stops at the first
error. The messages:

Lines

- `unrecognised line`
- `invalid actor: A(x)`
- `empty hotspot`
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
- `invalid item: {Backlog}`

Structure

- `read model {Backlog} informs nothing`
- `hotspot must follow a flow or reaction, not 'when'` (also `'after'`)
- `'when' has no reactions` (also `'after'`)
- `'when' expects an event name, got (Ticket)` (also `'unless'`)
- `'when' refers to unknown event TicketSubmited`
- `'unless' refers to unknown event CustomerFolowedUp`

## Open questions

- One command → several events? (`-> A, B`)
