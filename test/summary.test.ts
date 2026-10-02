import { describe, expect, it } from 'vitest';
import { parse, summarize } from '../src/index.ts';

const summary = (text: string) => summarize(parse(text));

describe('summarize', () => {
  it('lists events each context reacts to from another', () => {
    const text = [
      '== Sales ==',
      'Customer: Place order -> OrderPlaced',
      '  after 1 hour unless Paid',
      '    then Cancel -> Cancelled',
      '== Payments ==',
      'when OrderPlaced',
      '  then Charge -> Paid',
      'when Cancelled',
      '  then Refund -> Refunded',
    ].join('\n');
    expect(summary(text)).toContain(
      '## Context dependencies\n\n' +
        'Each line: events of the first context that the second reacts to.\n\n' +
        '- Payments → Sales: Paid\n' +
        '- Sales → Payments: OrderPlaced, Cancelled\n',
    );
  });

  it('groups commands by actor, aggregate and external system', () => {
    const text = [
      'Member: Borrow -> (Loan) -> (Copy) -> Borrowed',
      '  then Remind -> (Loan) -> [Email] -> Reminded',
      'Member: Renew -> (Loan) -> Renewed',
      'every night: Report -> [Email] -> Reported',
      'Archive -> Archived',
    ].join('\n');
    const out = summary(text);
    expect(out).toContain('- Member: Borrow, Renew\n- Every night: Report\n- Unknown actor: Archive\n');
    expect(out).toContain('- Loan: Borrow, Remind, Renew\n- Copy: Borrow\n');
    expect(out).toContain('- Email: Remind, Report\n');
  });

  it('lists rules by aggregate', () => {
    const text = [
      'A: Borrow -> [Catalog] -> (Loan) -> Borrowed',
      '  * At most 5 loans',
      '  then Renew -> (Loan) -> Renewed',
      '    * Renew twice at most',
    ].join('\n');
    expect(summary(text)).toContain(
      '## Rules\n\nBusiness rules each aggregate enforces.\n\n- Loan: At most 5 loans, Renew twice at most\n',
    );
  });

  it('lists events nothing reacts to', () => {
    const out = summary('Started\nA: Do -> Done\n  then React -> Reacted\nwhen Started\n  then Go -> Gone');
    expect(out).toContain('## Events nothing reacts to');
    expect(out).toContain('- Reacted\n- Gone\n');
    expect(out).not.toMatch(/- (Started|Done)\n/);
  });

  it('collects hotspots with where they are', () => {
    expect(
      summary('! Big?\n== Sales ==\n! Scope?\nA: Do -> Done\n  ! Why?\n  then React -> Reacted\n    ! How?'),
    ).toContain('## Hotspots (4)\n\n- Big?\n- Scope? (Sales)\n- Why? (Sales, Do)\n- How? (Sales, React)\n');
  });

  it('leaves out empty parts', () => {
    expect(summary('Started')).toBe(
      '## Events nothing reacts to\n\nUsually the end of a flow; check none of them is a missing step.\n\n- Started\n',
    );
  });
});
