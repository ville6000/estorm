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

| Syntax           | Sticky          | Colour      |
|------------------|-----------------|-------------|
| `Actor:`         | actor           | pale yellow |
| text after `:` / `then` | command  | blue        |
| `then`           | policy          | lilac       |
| `(Name)`         | aggregate       | yellow      |
| `[Name]`         | external system | pink        |
| `{Name}`         | read model      | green       |
| last chain item  | event           | orange      |
| `! text`         | hotspot         | red         |
| `== Name ==`     | section (lane)  | grey band   |

## Statements

**Flow** — an actor issues a command, producing an event. Read models, the
actor (or policy) and the command touch, as one group; arrows start at the
command. Lanes are separated by a grey gap.

```
Actor: Command -> Event
Actor: Command -> (Aggregate) -> Event
Actor: Command -> [External] -> Event
```

**Reaction** — a policy reacts to the event of the nearest less-indented
flow or reaction above it, and issues a command. The policy sticky is labelled
`whenever <trigger event>`.

```
  then Command -> Event
  then Command -> [External] -> (Aggregate) -> Event
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

**Hotspot** — a question or problem, caused by the nearest flow or reaction
above it in the same section. Hotspots before the first flow belong to the
whole board; right after a section header, to that section. A hotspot
directly after `when` is an error.
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
- Flows, `when` and sections start at column 0.
- A `then` line must be exactly one level deeper than its parent.

## Grammar (EBNF)

```ebnf
document   = { line , newline } ;
line       = blank | comment | hotspot | read-model | flow | reaction
           | when | section ;

blank      = { " " } ;
comment    = indent , "#" , text ;
hotspot    = indent , "!" , text ;
read-model = indent , "{" , name , "}" ;
flow       = name , ":" , name , chain ;
reaction   = indent , "then" , " " , name , chain ;
when       = "when" , " " , name ;
section    = "==" , text , "==" ;

chain      = { arrow , ( aggregate | external ) } , arrow , name ;
arrow      = "->" ;
aggregate  = "(" , name , ")" ;
external   = "[" , name , "]" ;

indent     = { "  " } ;
name       = text without "->" "(" ")" "[" "]" "{" "}" ":" ;
text       = any characters up to end of line ;
```

## Target AST

Line numbers are 1-based and kept for error messages and later editor features.
For the example above:

```clojure
[{:type :flow :line 3
  :informed-by [{:type :read-model :name "Ticket form with topic list" :line 2}]
  :actor "Customer"
  :command "Submit ticket"
  :via [{:type :aggregate :name "Ticket"}]
  :event "TicketSubmitted"
  :reactions
  [{:type :reaction :line 4
    :informed-by []
    :command "Fetch customer details"
    :via [{:type :external :name "CRM"}]
    :event "CustomerDetailsFetched"
    :hotspots []
    :reactions []}
   {:type :reaction :line 6
    :informed-by [{:type :read-model :name "Department topic mapping" :line 5}]
    :command "Assign by topic"
    :via [{:type :aggregate :name "Ticket"}]
    :event "TicketAssigned"
    :hotspots [{:type :hotspot :text "Who owns the topic → department mapping?" :line 7}]
    :reactions []}]
  :hotspots []}]
```

Read models are moved into `:informed-by` of the statement they precede.
A read model with no following flow or reaction is an error.

Hotspots go into `:hotspots` of the flow or reaction that caused them. Board
and section hotspots are top-level, in source order with the flows.

Sections are top-level markers; an item belongs to the nearest section above.
A `when` takes its reactions:

```clojure
[{:type :section :name "Sales" :line 1}
 {:type :flow :line 2 ... :event "OrderPlaced"}
 {:type :section :name "Billing" :line 3}
 {:type :when :line 4 :event "OrderPlaced" :hotspots []
  :reactions [{:type :reaction :line 5 ...}]}]
```

## Errors

Report as `<file>:<line>: <message>`, e.g.

- `tickets.estorm:4: 'then' has no parent flow`
- `tickets.estorm:7: chain must end with an event, got [CRM]`
- `tickets.estorm:9: tab in indentation`
- `tickets.estorm:12: read model {Backlog} informs nothing`
- `tickets.estorm:3: unrecognised line`
- `tickets.estorm:20: 'when' refers to unknown event TicketSubmited`
- `tickets.estorm:20: 'when' has no reactions`

## Open questions

- One command → several events? (`-> A, B`)
- Time-triggered policies (e.g. "30 days after TicketCompleted")?
