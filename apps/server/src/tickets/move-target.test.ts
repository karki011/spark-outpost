import { describe, expect, it } from 'vitest';
import type { TicketStatus } from '@spark-outpost/contracts';
import { planMove, resolveGroup, type MoveRequest, type MoveSettings } from './move-target.ts';
import type { SourceState, StateKind } from './status.ts';

const NONE: MoveSettings = { mapped: {}, chosen: {} };
const of = (kind: StateKind, ...names: string[]): SourceState[] =>
  names.map((name) => ({ name, kind }));
const done = (...names: string[]) => of('done', ...names);
const started = (...names: string[]) => of('started', ...names);

function chosen(statuses: SourceState[], target: TicketStatus, settings = NONE) {
  const result = resolveGroup(statuses, target, settings);
  return result.found ? `${result.state.name} by ${result.rule}` : result.problem;
}

describe('the finished status for a merged pull request', () => {
  it('uses the status named Done, whatever else is in the category', () => {
    expect(chosen(done('Rejected', 'Done'), 'done')).toBe('Done by name');
    expect(chosen(done('Closed', ' done ', "Won't Do"), 'done')).toBe(' done  by name');
  });

  it('accepts one other finished name only when nothing is named Done', () => {
    expect(chosen(done('Rejected', 'Closed', 'Shipped'), 'done')).toBe('Closed by name');
    expect(chosen(done('Closed', 'Resolved'), 'done')).toBe('ambiguous');
    expect(chosen(done('Closed', 'Done'), 'done')).toBe('Done by name');
  });

  it('uses the only status that does not mean the work was dropped', () => {
    expect(chosen(done('Rejected', 'Shipped', 'Duplicate'), 'done')).toBe('Shipped by only_status');
  });

  it('never picks a dropped status by itself, even when it is the only one', () => {
    expect(chosen(done('Rejected'), 'done')).toBe('never');
    const names = [
      'Rejected',
      "Won't Do",
      'Won’t Fix',
      'WONTFIX',
      'Cancelled',
      'Canceled',
      'Declined',
      'Duplicate',
      'Invalid',
      'Abandoned',
      'Not Doing',
      'obsolete',
    ];
    for (const name of names) expect(chosen(done(name), 'done')).toBe('never');
    expect(chosen(done(...names), 'done')).toBe('never');
  });

  it('does not guess between several finished statuses', () => {
    const result = resolveGroup(done('Shipped', 'Released', 'Rejected'), 'done', NONE);
    expect(result).toEqual({
      found: false,
      problem: 'ambiguous',
      names: ['Shipped', 'Released', 'Rejected'],
    });
  });

  it('uses the status the user chose, even a dropped one', () => {
    const statuses = done('Done', 'Rejected');
    expect(chosen(statuses, 'done', { mapped: {}, chosen: { done: 'rejected' } })).toBe(
      'Rejected by setting',
    );
    expect(
      chosen(statuses, 'done', { mapped: { done: 'Rejected' }, chosen: { done: 'Done' } }),
    ).toBe('Rejected by project_setting');
  });

  it('falls back to the rules when the chosen name is not in this project', () => {
    const settings = { mapped: {}, chosen: { done: 'Shipped' } };
    expect(chosen(done('Done', 'Rejected'), 'done', settings)).toBe('Done by name');
    expect(chosen(done('Rejected'), 'done', settings)).toBe('never');
    expect(chosen(done('Done'), 'done', { mapped: { done: 'QA passed' }, chosen: {} })).toBe(
      'none',
    );
  });
});

describe('the review and in-progress statuses', () => {
  const workflow = [
    ...of('todo', 'To Do'),
    ...started('Blocked', 'In Progress', 'On Hold', 'Code Review', 'In Review'),
    ...done('Done'),
  ];

  it('uses In Review and In Progress by name', () => {
    expect(chosen(workflow, 'in_review')).toBe('In Review by name');
    expect(chosen(workflow, 'in_progress')).toBe('In Progress by name');
    expect(chosen(workflow, 'todo')).toBe('To Do by name');
  });

  it('accepts one other known name', () => {
    expect(chosen(started('Blocked', 'Doing', 'Code Review'), 'in_review')).toBe(
      'Code Review by name',
    );
    expect(chosen(started('Blocked', 'Doing', 'Testing'), 'in_progress')).toBe('Doing by name');
    expect(chosen(started('Code Review', 'Review'), 'in_review')).toBe('ambiguous');
  });

  it('uses the only one, and never Blocked or On hold', () => {
    expect(chosen(started('Waiting for QA'), 'in_progress')).toBe('Waiting for QA by only_status');
    expect(chosen(started('Peer review', 'Building'), 'in_review')).toBe(
      'Peer review by only_status',
    );
    expect(chosen(started('Blocked', 'Building'), 'in_progress')).toBe('Building by only_status');
    expect(chosen(started('Blocked', 'On hold'), 'in_progress')).toBe('never');
    expect(chosen(started('Building', 'Testing'), 'in_progress')).toBe('ambiguous');
    expect(chosen(started('Building'), 'in_review')).toBe('none');
  });

  it('treats a chosen review status as review everywhere', () => {
    const settings = { mapped: {}, chosen: { in_review: 'Testing' } };
    const statuses = started('Building', 'Testing');
    expect(chosen(statuses, 'in_review', settings)).toBe('Testing by setting');
    expect(chosen(statuses, 'in_progress', settings)).toBe('Building by only_status');
  });
});

describe('planning a move', () => {
  const statuses = [
    ...of('todo', 'To Do'),
    ...started('In Progress', 'In Review'),
    ...done('Rejected', 'Done'),
  ];
  const plan = (request: MoveRequest, change: Partial<Parameters<typeof planMove>[0]> = {}) =>
    planMove({
      key: 'CP-48243',
      sourceName: 'Jira',
      project: 'CP',
      current: { name: 'In Review', kind: 'started' },
      statuses,
      reachable: statuses,
      request,
      settings: NONE,
      ...change,
    });

  it('names the from and to status and the rule that chose it', () => {
    expect(plan({ group: 'done' })).toEqual({
      from: 'In Review',
      to: 'Done',
      status: 'done',
      rule: 'name',
      stopped: null,
      message: null,
      statuses: ['To Do', 'In Progress', 'In Review', 'Rejected', 'Done'],
    });
  });

  it('does not move, and says where to choose, when the target is unclear', () => {
    const unclear = plan({ group: 'done' }, { statuses: done('Shipped', 'Released') });
    expect(unclear).toMatchObject({
      to: null,
      stopped: 'blocked',
      message:
        'CP-48243 was not moved: this project has several finished statuses (Shipped, Released). Choose one in Settings → Connectors → Jira.',
    });
    expect(plan({ group: 'done' }, { statuses: done('Rejected') })).toMatchObject({
      to: null,
      stopped: 'blocked',
      message:
        'CP-48243 was not moved: Spark never picks Rejected on its own. Choose a status in Settings → Connectors → Jira.',
    });
  });

  it('does not fall back when the workflow cannot reach the status', () => {
    const reachable = statuses.filter((state) => state.name !== 'Done');
    expect(plan({ group: 'done' }, { reachable })).toMatchObject({
      to: null,
      stopped: 'blocked',
      message:
        'CP-48243 was not moved: the Jira workflow does not allow moving it from In Review to Done.',
    });
  });

  it('leaves a ticket that is already there, or further along', () => {
    expect(plan({ group: 'in_review' })).toMatchObject({
      stopped: 'unchanged',
      message: 'Already In review.',
    });
    expect(plan({ group: 'in_progress' })).toMatchObject({ stopped: 'unchanged' });
    expect(plan({ group: 'done' }, { current: { name: 'Rejected', kind: 'done' } })).toMatchObject({
      stopped: 'unchanged',
      to: null,
    });
  });

  it('uses exactly the status a request names, or lists the real ones', () => {
    expect(plan({ name: ' rejected ' })).toMatchObject({
      to: 'Rejected',
      status: 'done',
      rule: 'exact',
    });
    expect(plan({ name: 'In Progress' })).toMatchObject({ to: 'In Progress', rule: 'exact' });
    expect(plan({ name: 'QA' })).toMatchObject({
      to: null,
      stopped: 'no_status',
      message:
        'CP-48243 has no status named QA. Its statuses: To Do, In Progress, In Review, Rejected, Done.',
    });
    expect(plan({ name: 'In Review' })).toMatchObject({
      stopped: 'unchanged',
      message: 'Already In Review.',
    });
  });

  it('keeps the plain message when a project has no status for the group', () => {
    const none = plan(
      { group: 'in_review' },
      {
        current: { name: 'To Do', kind: 'todo' },
        statuses: [...of('todo', 'To Do'), ...done('Done')],
      },
    );
    expect(none).toMatchObject({
      stopped: 'no_status',
      message: 'No status maps to In review in CP. Choose one in Settings → Connectors.',
    });
  });
});
