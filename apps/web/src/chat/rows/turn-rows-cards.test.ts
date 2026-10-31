import { describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import { foldedPart } from './turn-fold.ts';
import { turnRowParts, type TurnRowPart } from './turn-rows.ts';

const step = (name: string, startedAt: number, textOffset: number): StepView => ({
  name,
  status: 'done',
  startedAt,
  finishedAt: startedAt + 10,
  textOffset,
});

function shape(parts: readonly TurnRowPart[]): string[] {
  return parts.map((part) => {
    if (part.kind === 'cards') return `cards:${part.ids.join(',')}`;
    if (part.kind === 'text') return `text:${part.text.trim()}`;
    return part.kind;
  });
}

const text = 'Creating the ticket. Done, opening the pull request.';

describe('turn rows with cards', () => {
  it('puts an answered card and a flag just before the next step that started after them', () => {
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 1000, 0), step('Tool search', 5000, 20)],
      commands: [],
      cards: [
        { id: 'created', time: 2000 },
        { id: 'flag', time: 3000 },
      ],
    });
    expect(shape(parts)).toEqual([
      'rows',
      'text:Creating the ticket.',
      'cards:created,flag',
      'rows',
      'text:Done, opening the pull request.',
    ]);
  });

  it('places a card after every step at the end of the text', () => {
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 1000, 0)],
      commands: [],
      cards: [{ id: 'late', time: 9000 }],
    });
    expect(shape(parts)).toEqual(['rows', `text:${text}`, 'cards:late']);
  });

  it('keeps a card raised during a step above the text written after that step', () => {
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 1000, 0)],
      commands: [],
      cards: [{ id: 'asked', time: 1005 }],
    });
    expect(shape(parts)).toEqual(['rows', 'cards:asked', `text:${text}`]);
  });

  it('keeps a card raised during a step that is still open with that step', () => {
    const open: StepView = { name: 'Run tests', status: 'open', startedAt: 1000, textOffset: 20 };
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 500, 0), open],
      commands: [],
      cards: [{ id: 'asked', time: 9000 }],
    });
    expect(shape(parts)).toEqual([
      'rows',
      'text:Creating the ticket.',
      'rows',
      'cards:asked',
      'text:Done, opening the pull request.',
    ]);
  });

  it('uses the text written when the card arrived over its time', () => {
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 1000, 0)],
      commands: [],
      cards: [{ id: 'asked', time: 9000, textOffset: 20 }],
    });
    expect(shape(parts)).toEqual([
      'rows',
      'text:Creating the ticket.',
      'cards:asked',
      'text:Done, opening the pull request.',
    ]);
  });

  it('keeps cards out of a closed fold and in place inside an open one', () => {
    const parts = turnRowParts({
      text,
      steps: [step('Read `a.ts`', 1000, 0), step('Tool search', 5000, 20)],
      commands: [],
      cards: [{ id: 'created', time: 2000 }],
    });
    const closed = parts.map((_, index) => foldedPart(parts, index));
    const open = parts.map((_, index) => foldedPart(parts, index, true));
    expect(closed).toEqual([true, true, false, true, false]);
    expect(open).toEqual([true, true, true, true, false]);
  });
});
