import { describe, expect, it } from 'vitest';
import { compactPrompt, compactTakesInput } from './agent-compact.ts';
import { HANDOFF_SECTIONS, handoffInstructions } from './handoff-instructions.ts';
import { liveStateText } from './live-state.ts';
import { breakOf, planDone } from './natural-break.ts';
import { cardTriggerText, triggerLine } from './trigger-lines.ts';

const checkedAt = new Date('2026-11-18T09:05:30Z');

describe('liveStateText', () => {
  it('lists the branch, the chat’s open pull request and uncommitted changes', () => {
    const text = liveStateText({
      checkedAt,
      branch: 'spark/cents',
      pulls: [
        {
          number: 42,
          url: 'https://github.com/acme/app/pull/42',
          state: 'open',
          draft: true,
          checks: 'failing',
          polledAt: new Date('2026-11-18T09:01:00Z'),
        },
      ],
      changes: [{ path: 'src/parse.ts', additions: 3, deletions: 1 }],
    });
    expect(text).toBe(
      [
        '## Live state, checked by Spark at 2026-11-18 09:05 UTC',
        '- Branch: spark/cents',
        '- Pull request #42 (open, draft, checks failing; GitHub last read 2026-11-18 09:01 UTC): https://github.com/acme/app/pull/42',
        '- Uncommitted changes: src/parse.ts (+3 -1)',
      ].join('\n'),
    );
  });

  it('says nothing when there is nothing to report', () => {
    expect(liveStateText({ checkedAt, branch: null, pulls: [], changes: [] })).toBe('');
  });

  it('caps a long list of changed files', () => {
    const changes = Array.from({ length: 32 }, (_, index) => ({
      path: `f${index}.ts`,
      additions: 1,
      deletions: 0,
    }));
    const text = liveStateText({ checkedAt, branch: null, pulls: [], changes });
    expect(text).toContain('f29.ts (+1 -0), and 2 more');
    expect(text).not.toContain('f30.ts');
  });
});

describe('handoffInstructions', () => {
  it('asks for every handoff section, omitted when empty, and attaches Spark’s live state', () => {
    const live = '## Live state, checked by Spark at 2026-11-18 09:05 UTC\n- Branch: spark/cents';
    const text = handoffInstructions(live, checkedAt);
    for (const name of [
      'Goal and scope',
      'State',
      'Next steps',
      'Your decisions',
      'Open questions',
      'Gotchas',
      'Loose ends',
    ]) {
      expect(text).toContain(`- ${name}: `);
    }
    expect(HANDOFF_SECTIONS).toHaveLength(7);
    expect(text).toContain('leave out any that would be empty');
    expect(text).toContain('quoted or closely paraphrased, each with its date');
    expect(text).toContain('You cannot run commands while compacting');
    expect(text).toContain('as unverified');
    expect(text).toContain('Today is 2026-11-18.');
    expect(text.endsWith(live)).toBe(true);
  });

  it('still asks to mark unverified claims without live state', () => {
    const text = handoffInstructions('', checkedAt);
    expect(text).toContain('as unverified');
    expect(text).not.toContain('Live state');
  });
});

describe('the /compact prompt', () => {
  it('sends the instructions only to an agent whose /compact takes input', () => {
    const claude = [{ name: 'compact', description: 'Clear history', hint: '<instructions>' }];
    const codex = [{ name: 'compact', description: 'Summarize', hint: null }];
    expect(compactTakesInput(claude)).toBe(true);
    expect(compactTakesInput(codex)).toBe(false);
    expect(compactPrompt({ compactTakesInput: true }, 'Write a handoff')).toBe(
      '/compact Write a handoff',
    );
    expect(compactPrompt({ compactTakesInput: false }, 'Write a handoff')).toBe('/compact');
    expect(compactPrompt({ compactTakesInput: true }, '')).toBe('/compact');
  });
});

describe('natural breaks', () => {
  const done = { content: 'Ship it', priority: 'medium', status: 'completed' };

  it('counts a plan only when every entry is completed', () => {
    expect(planDone([done, done])).toBe(true);
    expect(planDone([done, { ...done, status: 'in_progress' }])).toBe(false);
    expect(planDone([])).toBe(false);
    expect(planDone(null)).toBe(false);
    expect(planDone('nonsense')).toBe(false);
  });

  it('reads only a succeeded previous turn', () => {
    expect(breakOf({ status: 'succeeded', todo: [done], pull_request: false })).toBe('plan-done');
    expect(breakOf({ status: 'succeeded', todo: null, pull_request: true })).toBe('pull-request');
    expect(breakOf({ status: 'cancelled', todo: [done], pull_request: true })).toBeNull();
    expect(breakOf({ status: 'failed', todo: [done], pull_request: false })).toBeNull();
    expect(breakOf({ status: 'succeeded', todo: null, pull_request: false })).toBeNull();
    expect(breakOf(undefined)).toBeNull();
  });

  it('names why it compacted in the work log and on the card', () => {
    expect(triggerLine({ kind: 'break', why: 'plan-done' }, 64)).toBe(
      'Context compacted at a natural break: the last turn finished its plan (64% full)',
    );
    expect(triggerLine({ kind: 'threshold' }, 82)).toBe(
      'Context compacted at the compaction point (82% full)',
    );
    expect(cardTriggerText({ kind: 'break', why: 'pull-request' })).toBe(
      ' The last turn opened or updated a pull request, a natural break to compact.',
    );
    expect(cardTriggerText({ kind: 'threshold' })).toBe('');
  });
});
