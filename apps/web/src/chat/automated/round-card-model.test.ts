import { describe, expect, it } from 'vitest';
import type { FeedbackItem, RoundOutcome } from '@spark-outpost/contracts';
import { RUN, watch } from '../pull-request/watch-fixture.ts';
import {
  itemPlace,
  itemWord,
  groupSubtitle,
  groupTitle,
  roundBlocks,
  roundItems,
  roundOfTurn,
  roundsByPull,
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

describe('rounds folded into one card', () => {
  const turn = (id: string, prFollowUp = false) => ({ run: { id, prFollowUp } });
  const member = (runId: string, fields: Partial<RoundOutcome>, id = watch().id) => ({
    runId,
    found: {
      watch: watch({ id }),
      round: fields.round ?? 1,
      outcome: { ...outcome, runId, ...fields },
    },
  });

  it('blocks rounds in a row together and breaks at a turn of the user’s', () => {
    const blocks = roundBlocks([
      turn('a'),
      turn('r1', true),
      turn('r2', true),
      turn('b'),
      turn('r3', true),
    ]);
    expect(blocks.map((block) => block.map((entry) => entry.run.id))).toEqual([
      ['a'],
      ['r1', 'r2'],
      ['b'],
      ['r3'],
    ]);
  });

  it('keeps rounds of different pull requests, and unknown rounds, apart', () => {
    const other = '0190d7a0-0000-7000-8000-00000000aaaa';
    const groups = roundsByPull([
      member('r1', {}),
      member('r2', {}),
      member('r3', {}, other),
      { runId: 'r4', found: null },
      { runId: 'r5', found: null },
    ]);
    expect(groups.map((group) => group.map((entry) => entry.runId))).toEqual([
      ['r1', 'r2'],
      ['r3'],
      ['r4'],
      ['r5'],
    ]);
  });

  it('titles the card with the count and sums what the rounds did', () => {
    const members = [
      member('r1', { round: 1, replied: 2 }),
      member('r2', { round: 2, replied: 4, needs: 1 }),
      member('r3', { round: 3, replied: 0, merged: true }),
    ];
    expect(groupTitle(members)).toBe('PR #7 · 3 rounds');
    expect(groupSubtitle(members, null)).toBe(
      'Replied to 6 comments, pushed 3 times; 1 item needs you · last: merged the base and pushed',
    );
    expect(groupSubtitle(members, 'r3')).toBe('Round 3 is working');
    const quiet = [
      member('r1', { pushed: false, replied: 0 }),
      member('r2', { pushed: false, replied: 0 }),
    ];
    expect(groupSubtitle(quiet, null)).toMatch(/^Nothing changed · last: /);
  });
});
