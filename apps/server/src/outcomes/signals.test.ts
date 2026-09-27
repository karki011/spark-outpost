import { describe, expect, it } from 'vitest';
import type { OutcomeSignalKind } from '@spark-outpost/contracts';
import {
  agreement,
  classifyFollowUp,
  correctionPattern,
  feedbackPrompt,
  requestSimilarity,
  scoreOutcome,
  type PromptInput,
} from './signals.ts';

const kinds = (...list: OutcomeSignalKind[]) => list.map((kind) => ({ kind }));

describe('correction heuristic', () => {
  it.each([
    "that's wrong",
    'That’s not right, the header moved',
    'fix it please',
    "it didn't work",
    'Still failing on CI',
    'This is not what I asked for',
    'you broke the build',
    'No, use the other file.',
  ])('reads "%s" as a correction', (text) => {
    expect(correctionPattern(text)).not.toBeNull();
  });

  it.each([
    'Now add a dark mode toggle',
    'Thanks, that works',
    'What does this function return?',
    'nothing is wrong with the tests, add another one',
  ])('does not read "%s" as a correction', (text) => {
    expect(correctionPattern(text)).toBeNull();
  });
});

describe('follow-up classification', () => {
  const changed = { request: 'Rename the date helper in utils', changedFiles: true };

  it('prefers Jev when it classifies the follow-up as a fix after a change', () => {
    const signal = classifyFollowUp(changed, {
      text: 'the header still overlaps',
      jevCategory: 'bug_fix',
      sameChat: true,
    });
    expect(signal).toMatchObject({ kind: 'correction', source: 'jev' });
    expect(signal?.detail).toMatchObject({ category: 'bug_fix', heuristic: false });
  });

  it('falls back to the heuristic without Jev and records which', () => {
    const signal = classifyFollowUp(changed, {
      text: "that didn't work",
      jevCategory: null,
      sameChat: true,
    });
    expect(signal).toMatchObject({ kind: 'correction', source: 'heuristic' });
  });

  it('does not treat a new bug fix after an answer as a correction', () => {
    const signal = classifyFollowUp(
      { request: 'Explain the parser', changedFiles: false },
      {
        text: 'Now fix the tokenizer crash on empty input',
        jevCategory: 'bug_fix',
        sameChat: true,
      },
    );
    expect(signal).toBeNull();
  });

  it('spots a re-ask, also in another chat, but only corrections in the same chat', () => {
    const again = classifyFollowUp(changed, {
      text: 'rename the date helper in utils please',
      jevCategory: null,
      sameChat: false,
    });
    expect(again).toMatchObject({ kind: 're_ask', source: 'heuristic' });
    expect(
      classifyFollowUp(changed, { text: "that's wrong", jevCategory: null, sameChat: false }),
    ).toBeNull();
  });

  it('measures similarity on words, ignoring short requests', () => {
    expect(requestSimilarity('fix it', 'fix it')).toBe(0);
    expect(requestSimilarity('add a login page form', 'add the login page form')).toBeCloseTo(0.8);
    expect(requestSimilarity('add a login page', 'remove the cache layer')).toBe(0);
  });
});

describe('outcome score', () => {
  it('weights signals and lets explicit feedback decide the verdict', () => {
    const kept = scoreOutcome(kinds('kept', 'checks_passed'), null);
    expect(kept).toMatchObject({ score: 1, verdict: 'good' });
    expect(kept.reasons.map((reason) => reason.label)).toEqual([
      'Kept the changes',
      'Checks passed',
    ]);
    const mixed = scoreOutcome(kinds('kept', 'correction'), null);
    expect(mixed.verdict).toBe('mixed');
    expect(mixed.score).toBeCloseTo(-0.2);
    expect(scoreOutcome(kinds('kept', 'correction'), 'up').verdict).toBe('good');
    expect(scoreOutcome([], null)).toEqual({ score: null, verdict: 'unclear', reasons: [] });
  });

  it('ignores neutral pull-request review comments', () => {
    expect(scoreOutcome(kinds('pr_review_comments'), null).verdict).toBe('unclear');
  });
});

describe('when to show thumbs', () => {
  const base: PromptInput = {
    kind: 'change',
    succeeded: true,
    signals: kinds('kept'),
    askedInTask: false,
    roll: 0.99,
    sampleRate: 0.2,
  };

  it('asks when the signals are unclear or mixed', () => {
    expect(agreement(kinds('kept'))).toBe('unclear');
    expect(feedbackPrompt(base)).toBe('mixed');
    expect(feedbackPrompt({ ...base, signals: kinds('kept', 'checks_failed') })).toBe('mixed');
    expect(feedbackPrompt({ ...base, kind: 'answer', signals: [] })).toBe('mixed');
  });

  it('stays hidden when the signals agree, unless sampled', () => {
    const agreeing = { ...base, signals: kinds('kept', 'checks_passed') };
    expect(agreement(agreeing.signals)).toBe('agree');
    expect(feedbackPrompt(agreeing)).toBeNull();
    expect(feedbackPrompt({ ...agreeing, roll: 0.1 })).toBe('sampled');
    expect(feedbackPrompt({ ...base, signals: kinds('reverted', 'checks_failed') })).toBeNull();
  });

  it('never asks twice in a task, for other turns, or for runs that did not succeed', () => {
    expect(feedbackPrompt({ ...base, askedInTask: true })).toBeNull();
    expect(feedbackPrompt({ ...base, kind: 'other' })).toBeNull();
    expect(feedbackPrompt({ ...base, succeeded: false })).toBeNull();
  });
});
