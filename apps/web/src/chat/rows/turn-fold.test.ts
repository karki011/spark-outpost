import { describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import { canFold, foldedPart, foldLead, foldSummary } from './turn-fold.ts';
import { turnRowParts, type TurnRowPart } from './turn-rows.ts';

const done = (name: string): StepView => ({ name, status: 'done' });

function rows(key: string, steps: StepView[]): TurnRowPart {
  const [part] = turnRowParts({ text: '', steps, commands: [] });
  return { ...part!, key };
}

const text = (key: string, value: string): TurnRowPart => ({ kind: 'text', key, text: value });

describe('turn fold', () => {
  const parts: TurnRowPart[] = [
    text('t1', 'I will look at the invoice list first.'),
    rows('r1', [done('Read `a.ts`'), done('Read `b.ts`')]),
    { kind: 'steers', key: 's1', ids: ['m1'], wroteAfter: false },
    text('t2', 'Now wiring the button.'),
    rows('r2', [done('Edit `a.ts`'), done('Read `a.ts`')]),
    text('t3', 'Added Export CSV to the toolbar.'),
  ];

  it('folds step rows and notes before a steer and keeps the answer and steers out', () => {
    const folded = parts.map((_, index) => foldedPart(parts, index));
    expect(folded).toEqual([true, true, false, false, true, false]);
  });

  it('keeps every reply after a steered message out of the fold', () => {
    const steered: TurnRowPart[] = [
      { kind: 'steers', key: 's1', ids: ['m1'], wroteAfter: true },
      text('t1', 'SECOND-ONE'),
      rows('r1', [done('Read `a.ts`')]),
      { kind: 'steers', key: 's2', ids: ['m2'], wroteAfter: true },
      text('t2', 'THIRD-TWO'),
      rows('r2', [done('Read `b.ts`')]),
      text('t3', 'FIRST-DONE'),
    ];
    const shown = steered.filter((_, index) => !foldedPart(steered, index));
    expect(shown.map((part) => part.key)).toEqual(['s1', 't1', 's2', 't2', 't3']);
  });

  it('folds in-between notes in a turn nobody steered', () => {
    const plain = parts.filter((part) => part.kind !== 'steers');
    const folded = plain.map((_, index) => foldedPart(plain, index));
    expect(folded).toEqual([true, true, true, true, false]);
  });

  it('sums the steps of every group, counting a file once', () => {
    expect(foldSummary(parts)).toBe('edited 1 file, read 2 files');
  });

  it('has nothing to fold when the turn is only its answer', () => {
    expect(canFold([text('t1', 'Done.')])).toBe(false);
    expect(canFold(parts)).toBe(true);
  });

  it('says how long the turn worked', () => {
    expect(foldLead(88)).toBe('Worked for 1m 28s');
    expect(foldLead(12)).toBe('Worked for 12s');
    expect(foldLead(null)).toBe('Worked');
  });
});
