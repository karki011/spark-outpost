import { describe, expect, it } from 'vitest';
import type { PrWatch } from '@spark-outpost/contracts';
import {
  branchLine,
  chipSummary,
  ciState,
  groupByRepo,
  openedIn,
  openedLine,
  pullState,
  reviewLabel,
  worstCi,
} from './pull-request-model.ts';

const RUN = '0190d7a0-0000-7000-8000-000000000001';

function watch(fields: Partial<PrWatch> = {}): PrWatch {
  return {
    id: '0190d7a0-0000-7000-8000-0000000000aa',
    conversationId: '0190d7a0-0000-7000-8000-0000000000bb',
    repo: 'acme/widgets',
    number: 7,
    url: 'https://github.com/acme/widgets/pull/7',
    title: 'Tidy the notes',
    branch: 'spark/tidy',
    base: 'main',
    outside: false,
    followUp: true,
    opened: { via: 'agent', by: 'claude', runId: RUN, at: '2026-10-05T10:00:00.000Z' },
    phase: 'watching',
    doing: '',
    prState: 'open',
    draft: false,
    checks: 'passing',
    failingChecks: [],
    review: 'none',
    unknownReason: null,
    rounds: 0,
    maxRounds: 3,
    newComments: 0,
    approvalId: null,
    lastPolledAt: null,
    lastError: null,
    items: [],
    ...fields,
  };
}

describe('pull request state', () => {
  it('reads draft, open, merged and closed', () => {
    expect(pullState(watch({ draft: true }))).toBe('draft');
    expect(pullState(watch())).toBe('open');
    expect(pullState(watch({ prState: 'merged', draft: true }))).toBe('merged');
    expect(pullState(watch({ prState: 'closed' }))).toBe('closed');
  });

  it('calls checks unknown when GitHub could not be read', () => {
    expect(ciState(watch({ unknownReason: 'GitHub is not connected.' }))).toBe('unknown');
    expect(ciState(watch({ checks: 'pending' }))).toBe('pending');
  });
});

describe('the worst check state of a chat', () => {
  it('puts failing before running, unknown and passing', () => {
    const passing = watch();
    const pending = watch({ number: 8, checks: 'pending' });
    const failing = watch({ number: 9, checks: 'failing' });
    const unknown = watch({ number: 10, unknownReason: 'No access.' });
    expect(worstCi([passing, unknown])).toBe('unknown');
    expect(worstCi([passing, unknown, pending])).toBe('pending');
    expect(worstCi([passing, pending, failing])).toBe('failing');
  });

  it('ignores merged and closed pull requests while another is open', () => {
    const merged = watch({ prState: 'merged', checks: 'failing' });
    expect(worstCi([merged, watch({ number: 8 })])).toBe('passing');
    expect(worstCi([merged])).toBe('failing');
  });
});

describe('the header chip', () => {
  it('is absent without pull requests', () => {
    expect(chipSummary([])).toBeNull();
  });

  it('names a single pull request and counts several', () => {
    expect(chipSummary([watch()])).toMatchObject({
      text: 'PR #7',
      label: 'Pull request acme/widgets#7, checks passing',
    });
    expect(chipSummary([watch(), watch({ number: 8, checks: 'failing' })])).toMatchObject({
      text: '2 PRs',
      ci: 'failing',
      label: '2 pull requests, checks failing',
    });
  });
});

describe('the Links list', () => {
  it('groups by repo, the chat’s own repos first and newest pull request on top', () => {
    const groups = groupByRepo([
      watch({ repo: 'zeta/outside', number: 3, outside: true }),
      watch({ number: 7 }),
      watch({ number: 12 }),
      watch({ repo: 'acme/api', number: 2 }),
    ]);
    expect(groups.map((group) => [group.repo, group.pulls.map((pull) => pull.number)])).toEqual([
      ['acme/api', [2]],
      ['acme/widgets', [12, 7]],
      ['zeta/outside', [3]],
    ]);
    expect(groups.at(-1)!.outside).toBe(true);
  });

  it('describes the branch, the review and who opened it', () => {
    expect(branchLine(watch())).toBe('spark/tidy → main');
    expect(branchLine(watch({ base: null }))).toBe('spark/tidy');
    expect(branchLine(watch({ branch: '' }))).toBeNull();
    expect(reviewLabel(watch())).toBeNull();
    expect(reviewLabel(watch({ review: 'changes_requested', newComments: 2 }))).toBe(
      'Changes requested · 2 open comments',
    );
    const name = (id: string) => id.toUpperCase();
    expect(openedLine(watch().opened, name)).toBe('Opened by CLAUDE');
    expect(openedLine({ ...watch().opened, via: 'terminal' }, name)).toBe(
      'Opened from the terminal',
    );
    expect(openedLine({ ...watch().opened, via: 'discovery' }, name)).toBe(
      'Found on this chat’s branch',
    );
    expect(openedLine({ ...watch().opened, via: 'ship' }, name)).toBe('Opened by Spark');
  });
});

describe('the turn row', () => {
  it('lists the pull requests opened in the runs of one turn, oldest first', () => {
    const later = watch({
      number: 8,
      opened: { via: 'agent', by: 'codex', runId: 'child', at: '2026-10-05T10:05:00.000Z' },
    });
    const elsewhere = watch({ number: 9, opened: { ...watch().opened, runId: 'other' } });
    const terminal = watch({
      number: 10,
      opened: { via: 'terminal', by: 'terminal', runId: null, at: '2026-10-05T09:00:00.000Z' },
    });
    expect(
      openedIn([later, elsewhere, terminal, watch()], [RUN, 'child']).map((pull) => pull.number),
    ).toEqual([7, 8]);
  });
});
