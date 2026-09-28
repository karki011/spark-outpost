import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { activeTime, exceededLimit, extendLimits } from './budget.ts';
import {
  asksForLoop,
  asksToKeep,
  autoContinueOption,
  fixesFindingsItself,
  shipsByItself,
} from './checkpoint-policy.ts';
import {
  asksForReview,
  destructiveByRule,
  followUpByRule,
  isLargeDiff,
  planOnlyByRule,
  questionByRule,
  reviewsExistingByRule,
  trivialByRule,
} from './risk-rules.ts';
import { oneTierUp, strongerEffort, tierLadder, topTier } from './tiers.ts';

describe('risk rules', () => {
  it('calls deletions, drops, data migrations, history rewrites and secrets destructive', () => {
    for (const request of [
      'Drop the legacy users table',
      'Delete the old reports folder',
      'Migrate the orders data to the new schema',
      'git reset --hard and force push',
      'Remove the files under tmp/',
      'Rotate the key in .env',
    ]) {
      expect(destructiveByRule(request), request).toBe(true);
    }
    for (const request of [
      'Rename formatDate to formatDay in src/dates.ts',
      'Add a CSV export to the reports page',
      'Fix the typo in README.md',
    ]) {
      expect(destructiveByRule(request), request).toBe(false);
    }
  });

  it('calls short, local wording and formatting fixes trivial', () => {
    expect(trivialByRule('Fix the typo in README.md')).toBe(true);
    expect(trivialByRule('Rename formatDate to formatDay in src/dates.ts')).toBe(true);
    expect(trivialByRule('Rename formatDate in src/a.ts and src/b.ts')).toBe(false);
    expect(trivialByRule('Add a CSV export to the reports page')).toBe(false);
    expect(trivialByRule('Delete the typo file')).toBe(false);
  });

  it('keeps a Critic for a review of existing changes or of the requested work', () => {
    expect(asksForReview('Review my changes to the parser')).toBe(true);
    expect(asksForReview('Can you look over the diff?')).toBe(true);
    expect(asksForReview('Review and fix the parser')).toBe(true);
    expect(asksForReview('Add a retry. When it is built, have a reviewer check the change.')).toBe(
      true,
    );
    expect(asksForReview('Address the review comments on the parser')).toBe(false);
    expect(asksForReview('Add a retry to the upload')).toBe(false);
  });

  it('reads a leading review of existing changes, with nothing to change, as review-only', () => {
    for (const request of [
      "Review my uncommitted changes before I commit them. Don't change anything; just tell me what's wrong.",
      'Can you look over my staged changes?',
      'Check the diff on this branch for bugs',
      'Please review the current changes',
    ]) {
      expect(reviewsExistingByRule(request), request).toBe(true);
    }
    for (const request of [
      'Review my changes to the parser and fix what you find',
      'Review my uncommitted changes, then fix the bugs',
      'Add a retry. When it is built, have a reviewer check the change.',
      'Add a retry, then review the changes',
      'Review and fix the parser',
      'Check that the tests pass',
    ]) {
      expect(reviewsExistingByRule(request), request).toBe(false);
    }
  });

  it('reads explicit plan-only wording as a plan request, never a brainstorm or a plan-then-build', () => {
    for (const request of [
      "Plan adding CSV export to Analytics. Plan only for now: don't change any files.",
      'Plan adding CSV export to Analytics',
      'Just a plan for now: how would we split the reports module?',
      'Write up a plan for moving auth to JWT',
      'Can you draft a plan for the tags feature?',
    ]) {
      expect(planOnlyByRule(request), request).toBe(true);
    }
    for (const request of [
      'Brainstorm a few ways we could show that, with the trade-offs of each. Options only for now: no plan and no changes.',
      'Plan the CSV export and then build it',
      "How does the code scan decide which files to read? Just answer; don't change anything.",
      'Add CSV export to the Spend tab',
      "Fix the typo. Don't change any other files.",
    ]) {
      expect(planOnlyByRule(request), request).toBe(false);
    }
  });

  it('reads a question mark without a build verb as a question', () => {
    expect(questionByRule('How does the retry logic work?')).toBe(true);
    expect(questionByRule('Can you add a retry?')).toBe(false);
    expect(questionByRule('Explain the retry logic')).toBe(false);
  });

  it('treats short references back, or a quick reply, as a follow-up', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    const old = new Date('2026-09-27T09:00:00Z');
    expect(followUpByRule('also handle empty input', old, now)).toBe(true);
    expect(followUpByRule('now add a logout button to the header', old, now)).toBe(false);
    expect(
      followUpByRule(
        'now add a logout button to the header',
        new Date('2026-09-27T09:55:00Z'),
        now,
      ),
    ).toBe(true);
    expect(followUpByRule('add a logout button', null, now)).toBe(false);
  });

  it('calls a diff large at 400 changed lines or 10 files, not counting lockfiles', () => {
    const file = (path: string, additions: number) => ({ path, additions, deletions: 0 });
    expect(isLargeDiff([file('src/a.ts', 399)])).toBe(false);
    expect(isLargeDiff([file('src/a.ts', 300), file('src/b.ts', 100)])).toBe(true);
    expect(isLargeDiff([file('src/a.ts', 10), file('pnpm-lock.yaml', 5000)])).toBe(false);
    const many = Array.from({ length: 10 }, (_, index) => file(`src/${index}.ts`, 1));
    expect(isLargeDiff(many)).toBe(true);
  });
});

describe('level checkpoints', () => {
  it('asks to keep changes at Ask before edits when files changed', () => {
    expect(asksToKeep('balanced', 3)).toBe(true);
    expect(asksToKeep('balanced', 0)).toBe(false);
    expect(asksToKeep('hands-off', 3)).toBe(false);
    expect(asksToKeep('full-auto', 3)).toBe(false);
  });

  it('offers the Critic fix on the keep card only at Ask before edits', () => {
    expect(fixesFindingsItself('balanced')).toBe(false);
    expect(fixesFindingsItself('hands-off')).toBe(true);
    expect(fixesFindingsItself('full-auto')).toBe(true);
  });

  it('ships by itself only at Full auto, and only with changed files', () => {
    expect(shipsByItself('full-auto', 2)).toBe(true);
    expect(shipsByItself('full-auto', 0)).toBe(false);
    expect(shipsByItself('hands-off', 2)).toBe(false);
    expect(shipsByItself('balanced', 2)).toBe(false);
  });
});

describe('budgets', () => {
  const limits = { activeLimitMs: 1000, toolCallLimit: 3, costCapUsd: null };

  it('excludes approval waits from active time', () => {
    expect(activeTime(10_000, 9_500)).toBe(500);
    expect(activeTime(100, 500)).toBe(0);
  });

  it('names the first limit that ran out', () => {
    expect(exceededLimit({ activeMs: 999, toolCalls: 2, costUsd: 5 }, limits)).toBeNull();
    expect(exceededLimit({ activeMs: 1000, toolCalls: 0, costUsd: 0 }, limits)).toBe('time');
    expect(exceededLimit({ activeMs: 0, toolCalls: 3, costUsd: 0 }, limits)).toBe('tool_calls');
    expect(
      exceededLimit({ activeMs: 0, toolCalls: 0, costUsd: 2 }, { ...limits, costCapUsd: 2 }),
    ).toBe('cost');
  });

  it('continuing grants one more full allowance from where you are', () => {
    const usage = { activeMs: 1200, toolCalls: 5, costUsd: 0 };
    expect(extendLimits(limits, usage, limits)).toEqual({
      activeLimitMs: 2200,
      toolCallLimit: 8,
      costCapUsd: null,
    });
  });
});

describe('model tiers', () => {
  const claude = [
    { id: 'default', label: 'Default (recommended)' },
    { id: 'opus[1m]', label: 'Opus 5.5' },
    { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' },
    { id: 'sonnet', label: 'Sonnet 5' },
    { id: 'haiku', label: 'Haiku 4.5' },
  ];
  const codex = [
    { id: 'gpt-6-astra', label: '6 Astra' },
    { id: 'gpt-6-sol', label: '6 Sol' },
    { id: 'gpt-6-luna', label: '6 Luna' },
  ];

  it('orders Haiku, Sonnet, Opus and the Codex equivalents, leaving frontier models off', () => {
    expect(tierLadder(claude).map((model) => model.id)).toEqual(['haiku', 'sonnet', 'opus[1m]']);
    expect(tierLadder(codex).map((model) => model.id)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(topTier(claude)?.id).toBe('opus[1m]');
  });

  it('escalates one tier at a time and stops at the top', () => {
    expect(oneTierUp(claude, 'haiku')?.id).toBe('sonnet');
    expect(oneTierUp(claude, 'sonnet')?.id).toBe('opus[1m]');
    expect(oneTierUp(claude, 'opus[1m]')).toBeNull();
    expect(oneTierUp(claude, 'default')).toBeNull();
  });

  it('raises effort when the model is already at the top, never to max', () => {
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'medium')).toBe('high');
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'high')).toBe('high');
  });
});

describe('auto-continue', () => {
  it('stops and reports on the retry and loop cards, and takes the likely reading when vague', () => {
    expect(autoContinueOption('retry', false)).toBe(CHECKPOINT_OPTION.stopReport);
    expect(autoContinueOption('stuck', false)).toBe(CHECKPOINT_OPTION.stopReport);
    expect(autoContinueOption('clarify', true)).toBe(CHECKPOINT_OPTION.clarifyRules);
  });

  it('never auto-continues the user-owned cards', () => {
    expect(autoContinueOption('clarify', false)).toBeNull();
    expect(autoContinueOption('accept', false)).toBeNull();
    expect(autoContinueOption('budget', false)).toBeNull();
    expect(autoContinueOption('merge_conflict', false)).toBeNull();
  });

  it('asks about a loop only at the levels that ask', () => {
    expect(asksForLoop('balanced')).toBe(true);
    expect(asksForLoop('hands-off')).toBe(false);
    expect(asksForLoop('full-auto')).toBe(false);
  });
});
