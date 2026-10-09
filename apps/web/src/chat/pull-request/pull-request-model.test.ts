import { describe, expect, it } from 'vitest';
import {
  branchLine,
  ciState,
  groupByRepo,
  lineChange,
  lineChangeLabel,
  openedIn,
  openedLine,
  pullState,
  refreshProblemLine,
  repoLabels,
  reviewLabel,
  worstCi,
} from './pull-request-model.ts';
import { RUN, watch } from './watch-fixture.ts';

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

describe('what the row says about a pull request', () => {
  it('names the repository alone unless two repositories in the chat share that name', () => {
    const widgets = watch({ repo: 'acme/widgets' });
    const gadgets = watch({ number: 3, repo: 'acme/gadgets' });
    const fork = watch({ number: 4, repo: 'maya/widgets' });
    expect([...repoLabels([widgets, gadgets]).values()]).toEqual(['widgets', 'gadgets']);
    const labels = repoLabels([widgets, gadgets, fork]);
    expect(labels.get('acme/widgets')).toBe('acme/widgets');
    expect(labels.get('maya/widgets')).toBe('maya/widgets');
    expect(labels.get('acme/gadgets')).toBe('gadgets');
    expect(
      repoLabels([widgets, watch({ number: 8, repo: 'Acme/Widgets' })]).get('acme/widgets'),
    ).toBe('widgets');
  });

  it('shows line changes only when GitHub reported them', () => {
    expect(lineChange(watch())).toBeNull();
    expect(lineChange(watch({ additions: 2303, deletions: null }))).toBeNull();
    expect(lineChange(watch({ additions: 0, deletions: 0 }))).toBeNull();
    const change = lineChange(watch({ additions: 2303, deletions: 1 }));
    expect(change).toEqual({ added: 2303, removed: 1 });
    expect(lineChangeLabel(change!)).toBe('2,303 lines added, 1 removed');
  });

  it('puts every failed refresh in one plain line', () => {
    expect(refreshProblemLine('no_answer')).toBe('GitHub did not answer. Try again.');
    expect(refreshProblemLine('offline')).toBe('GitHub did not answer. Try again.');
    expect(refreshProblemLine('not_connected')).toBe(
      'GitHub is not connected. Connect GitHub in Settings.',
    );
  });
});
