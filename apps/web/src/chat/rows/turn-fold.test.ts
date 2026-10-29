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

  it('folds step rows and in-between notes and keeps the answer and steers out', () => {
    const folded = parts.map((_, index) => foldedPart(parts, index));
    expect(folded).toEqual([true, true, false, true, true, false]);
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
