import { describe, expect, it } from 'vitest';
import type { FeedbackItem, RoundOutcome } from '@spark-outpost/contracts';
import { RUN, watch } from '../pull-request/watch-fixture.ts';
import {
  itemPlace,
  itemWord,
  roundItems,
  roundOfTurn,
  roundSubtitle,
  roundTitle,
} from './round-card-model.ts';

const item = (fields: Partial<FeedbackItem>): FeedbackItem => ({
  id: '0190d7a0-0000-7000-8000-0000000000c1',
  label: 'F1',
  kind: 'review_comment',
  author: 'greptile-apps[bot]',
  trusted: true,
  path: 'api/org.ts',
  line: 138,
  excerpt: 'Batches erase edits',
  url: 'https://github.com/acme/widgets/pull/7#c1',
  triage: 'fix',
  triagedBy: 'jev',
  state: 'in_round',
  round: 3,
  reply: null,
  ...fields,
});

const outcome: RoundOutcome = {
  runId: RUN,
  round: 3,
  ended: 'settled',
  pushed: true,
  merged: false,
  replied: 2,
  rerequested: false,
  needs: 0,
  unpushed: false,
};

const message = 'Spark: 2 review items arrived on PR #7, so I asked this chat to look. More.';

describe('which round a turn is', () => {
  it('uses the settled outcome, or the round in progress', () => {
    const settled = watch({ roundOutcomes: [outcome] });
    expect(roundOfTurn([settled], RUN)).toMatchObject({ round: 3, outcome });
    const running = watch({ roundRunId: RUN, rounds: 4 });
    expect(roundOfTurn([running], RUN)).toMatchObject({ round: 4, outcome: null });
    expect(roundOfTurn([watch()], RUN)).toBeNull();
  });

  it('lists only that round’s items', () => {
    const found = roundOfTurn(
      [watch({ roundRunId: RUN, rounds: 3, items: [item({}), item({ round: 2 })] })],
      RUN,
    )!;
    expect(roundItems(found)).toHaveLength(1);
  });
});

describe('the card’s words', () => {
  it('names the PR and round, and why the round started while it works', () => {
    const found = roundOfTurn([watch({ roundRunId: RUN, rounds: 3, items: [item({})] })], RUN)!;
    expect(roundTitle(found)).toBe('PR #7 · round 3');
    expect(roundSubtitle(found, message, true)).toBe('1 review item arrived · sent by Spark');
    expect(roundTitle(null)).toBe('PR follow-up');
    expect(roundSubtitle(null, message, true)).toBe(
      '2 review items arrived on PR #7 · sent by Spark',
    );
  });

  it('says what the round did once it settles', () => {
    const found = roundOfTurn([watch({ roundOutcomes: [outcome] })], RUN)!;
    expect(roundSubtitle(found, message, false)).toBe('Replied to 2 comments, pushed a fix');
  });

  it('labels each item by what Spark decided and where it is', () => {
    expect(itemWord(item({}))).toBe('Fix');
    expect(itemWord(item({ triage: 'question' }))).toBe('Answer');
    expect(itemWord(item({ kind: 'check' }))).toBe('Check');
    expect(itemPlace(item({}))).toBe('greptile-apps[bot] · api/org.ts:138');
    expect(itemPlace(item({ path: null }))).toBe('greptile-apps[bot]');
  });
});
