/**
 * How to fix each error and warning, by code: shown by `check` and `lint`
 * with `--format json`, mostly for AI agents fixing a board on their own.
 * One sentence or two, with the correct form where it helps.
 */
import type { WarningCode } from './lint.ts';
import type { ErrorCode } from './parser.ts';

export const HINTS: Record<ErrorCode | WarningCode, string> = {
  'unrecognised-line':
    'Each line is an event (`OrderPlaced`), a flow (`Customer: Place order -> (Order) -> OrderPlaced`), ' +
    '`then` or `after` indented under a step, `when Event`, `every <time>: Command -> Event`, `== Context ==`, ' +
    '`{Read model}`, `! hotspot`, `* rule` or `# comment`. Names cannot contain ( ) [ ] { } or :, so an ' +
    'aggregate or external system goes inside a chain, never on its own line.',
  'invalid-actor':
    'The actor before the colon is a plain name, without ( ) [ ] { }: `Customer: Place order -> OrderPlaced`.',
  'empty-hotspot': 'Write the question or problem after the `!`: `! What if the payment fails?`',
  'empty-rule': 'Write the rule after the `*`: `* A room is never double-booked`',
  'empty-section': 'Name the bounded context between the `==`: `== Sales ==`',
  'tab-indent': 'Indent with spaces, two per level, never tabs.',
  'odd-indent': 'Indent with two spaces per level: a `then` sits two spaces deeper than the step it reacts to.',
  'indented-top-level':
    'Flows, events, schedules, `when` and sections start at column 0. Only `then`, `after`, read models, ' +
    'hotspots and rules are indented.',
  'no-parent':
    'Put `then` or `after` directly under the flow, event, reaction or `when` it reacts to, two spaces deeper. ' +
    'To react to an event from elsewhere in the file, use `when EventName` at column 0 with the `then` under it.',
  'indent-too-deep': 'Indent `then` or `after` exactly two spaces deeper than the step it reacts to, not more.',
  'chain-without-event':
    'End the chain with the event the command produces: `then Send receipt -> [Email] -> ReceiptSent`. ' +
    'An event whose cause is not known yet needs no command: write just `ReceiptSent` on its own line.',
  'expected-command':
    'A chain starts with the command, then any (Aggregate) or [External], then the event: ' +
    '`Place order -> (Order) -> OrderPlaced`.',
  'expected-aggregate-or-external':
    'Only the last item of a chain is an event: mark items between the command and the event as (Aggregate) ' +
    'or [External]. A follow-up step goes on its own line, indented: `  then Charge card -> PaymentCaptured`. ' +
    'Several outcomes of one command are separated by commas: `Pay -> PaymentCaptured, PaymentFailed`.',
  'empty-chain-item': 'Remove the extra `->`, or fill in the missing name: `Command -> (Aggregate) -> Event`.',
  'empty-event-name': 'Remove the stray comma, or name the missing event.',
  'duplicate-event': 'Name each event once on the line.',
  'invalid-chain-item':
    'A chain item is a bare name, (Aggregate) or [External], with brackets closed and no { } or :. ' +
    'A read model goes on its own line, directly above the step it informs: `{Order history}`.',
  'dangling-read-model':
    'Put `{Read model}` directly above the flow or `then` it informs, at the same or a deeper indentation.',
  'misplaced-rule': 'Put `* rule` under the flow or `then` whose (Aggregate) enforces it.',
  'rule-without-aggregate':
    'Add the aggregate that enforces the rule to the step above it: `Book room -> (Booking) -> RoomBooked`.',
  'ambiguous-rule':
    'A rule belongs to one aggregate: move it under a step with exactly one (Aggregate), or split the step.',
  'misplaced-hotspot': 'A hotspot cannot follow `when` or `after` directly: put it after the `then` line under them.',
  'reaction-after-several-events':
    'A policy reacts to one event. Add `when OneOfTheEvents` at column 0 and put the `then` under it.',
  'no-reactions': 'Indent at least one `then Command -> Event` under it, two spaces deeper.',
  'expected-event-name':
    'Name an event here, without brackets or arrows: `when OrderPlaced`, `after 30 days unless PaymentCaptured`.',
  'unknown-event':
    'Name an event produced somewhere in this file, spelled exactly the same (names are case-sensitive).',
  'past-tense':
    'Name events as facts that happened, in the past tense: `OrderPlaced`, not `PlaceOrder`. If the board ' +
    'records a workshop, check with the people who were there before renaming.',
  'shared-aggregate':
    'An aggregate usually belongs to one bounded context. Name it per context (`SalesOrder`, `ShippingOrder`) ' +
    'or move its steps into one section, if that matches the domain.',
};
