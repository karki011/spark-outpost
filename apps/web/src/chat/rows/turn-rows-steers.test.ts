import { describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import { turnRowParts, type SteerMark, type TurnRowPart } from './turn-rows.ts';

const step = (name: string, startedAt: number, extra: Partial<StepView> = {}): StepView => ({
  name,
  status: 'done',
  startedAt,
  ...extra,
});

const anchored = (id: string, before: string, time: number): SteerMark => ({
  id,
  anchor: { textOffset: before.length, textBefore: before, textHeld: 0 },
  time,
});

const unread = (id: string): SteerMark => ({ id, anchor: null, time: Number.MAX_SAFE_INTEGER });

function shape(parts: readonly TurnRowPart[]): string[] {
  return parts.map((part) => {
    if (part.kind === 'steers') return `steers:${part.ids.join(',')}`;
    if (part.kind === 'text') return `text:${part.text.trim()}`;
    return part.kind;
  });
}

const OPENING = 'Checking CI.\n\n';

describe('messages sent during a turn', () => {
  it('sit where the agent took them in: after earlier steps, before its answer', () => {
    const text = `${OPENING}Lint fails on E501, fixing that first.`;
    const parts = turnRowParts({
      text,
      steps: [
        step('Read `ci.yml`', 1_000, { textOffset: OPENING.length, textBefore: OPENING }),
        step('Edit `a.py`', 3_000, { textOffset: text.length, textBefore: 'first.' }),
      ],
      commands: [],
      steers: [anchored('lint', OPENING, 2_000)],
    });
    expect(shape(parts)).toEqual([
      'text:Checking CI.',
      'rows',
      'steers:lint',
      'text:Lint fails on E501, fixing that first.',
      'rows',
    ]);
  });

  it('wait at the end, below everything the agent did, until it reads them', () => {
    const parts = turnRowParts({
      text: OPENING,
      steps: [step('Read `ci.yml`', 1_000, { textOffset: OPENING.length, textBefore: OPENING })],
      commands: [],
      steers: [unread('a'), unread('b')],
    });
    expect(shape(parts)).toEqual(['text:Checking CI.', 'rows', 'steers:a,b']);
  });

  it('never split a paragraph the agent was still writing when the message arrived', () => {
    const text = 'Checking CI and the review comments.\n\nOn it.';
    const parts = turnRowParts({
      text,
      steps: [],
      commands: [],
      steers: [anchored('mid', 'Checking CI', 2_000)],
    });
    expect(shape(parts)).toEqual([
      'text:Checking CI and the review comments.',
      'steers:mid',
      'text:On it.',
    ]);
  });

  it('note text the agent added to that paragraph after they arrived', () => {
    const [grown] = turnRowParts({
      text: 'Checking CI and the review comments.',
      steps: [],
      commands: [],
      steers: [anchored('mid', 'Checking CI', 2_000)],
    }).filter((part) => part.kind === 'steers');
    expect(grown).toMatchObject({ ids: ['mid'], wroteAfter: true });

    const [waiting] = turnRowParts({
      text: OPENING,
      steps: [],
      commands: [],
      steers: [anchored('end', OPENING, 2_000)],
    }).filter((part) => part.kind === 'steers');
    expect(waiting).toMatchObject({ ids: ['end'], wroteAfter: false });
  });

  it('note added text for a group only when it follows every message in it', () => {
    const [group] = turnRowParts({
      text: 'Checking CI and the review comments.',
      steps: [],
      commands: [],
      steers: [
        anchored('early', 'Checking CI', 2_000),
        anchored('late', 'Checking CI and the review comments.', 3_000),
      ],
    }).filter((part) => part.kind === 'steers');
    expect(group).toMatchObject({ ids: ['early', 'late'], wroteAfter: false });
  });

  it('follow a step that started at the same point in the reply but before they arrived', () => {
    const parts = turnRowParts({
      text: OPENING,
      steps: [
        step('Read `a.py`', 1_000, { textOffset: OPENING.length, textBefore: OPENING }),
        step('Read `b.py`', 3_000, { textOffset: OPENING.length, textBefore: OPENING }),
      ],
      commands: [],
      steers: [anchored('a', OPENING, 2_000)],
    });
    expect(shape(parts)).toEqual(['text:Checking CI.', 'rows', 'steers:a', 'rows']);
  });
});
