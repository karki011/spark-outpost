import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TicketMoveStatuses } from '@spark-outpost/contracts';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../test/fake-jira.ts';
import { LINEAR_KEY } from '../../test/fake-linear.ts';
import { startTicketStubs, type TicketStubs } from '../../test/ticket-support.ts';
import { jiraSource } from './jira.ts';
import { linearSource } from './linear.ts';

let stubs: TicketStubs;

beforeEach(async () => {
  stubs = await startTicketStubs();
});

afterEach(async () => {
  await stubs.close();
});

const jira = (moveStatuses: TicketMoveStatuses = {}) =>
  jiraSource(
    { siteUrl: stubs.jiraUrl, email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
    { statusMap: {}, moveStatuses },
    fetch,
  );
const linear = (moveStatuses: TicketMoveStatuses = {}) =>
  linearSource(LINEAR_KEY, { statusMap: {}, moveStatuses }, fetch, stubs.linearUrl);
const jiraStatus = (key: string) => stubs.jira.issues.find((issue) => issue.key === key)!.status;

function finishedStatuses(...names: string[]) {
  stubs.jira.workflows.WEB = {
    'To Do': 'new',
    'In Progress': 'indeterminate',
    ...Object.fromEntries(names.map((name) => [name, 'done' as const])),
  };
}

describe('Jira: the merged move', () => {
  it('goes to Done when Rejected is in the same category and listed first', async () => {
    finishedStatuses('Rejected', 'Done');
    expect(await jira().transition('WEB-418', { group: 'done' })).toMatchObject({
      moved: true,
      from: 'To Do',
      to: 'Done',
      rule: 'name',
    });
    expect(jiraStatus('WEB-418')).toBe('Done');
  });

  it('does not move when Rejected is the only finished status', async () => {
    finishedStatuses('Rejected');
    expect(await jira().transition('WEB-418', { group: 'done' })).toMatchObject({
      moved: false,
      to: null,
      stopped: 'blocked',
      message:
        'WEB-418 was not moved: Spark never picks Rejected on its own. Choose a status in Settings → Connectors → Jira.',
    });
    expect(jiraStatus('WEB-418')).toBe('To Do');
  });

  it('does not move when several finished statuses fit and none is Done', async () => {
    finishedStatuses('Shipped', 'Released');
    expect(await jira().transition('WEB-418', { group: 'done' })).toMatchObject({
      moved: false,
      message:
        'WEB-418 was not moved: this project has several finished statuses (Shipped, Released). Choose one in Settings → Connectors → Jira.',
    });
    expect(jiraStatus('WEB-418')).toBe('To Do');
  });

  it('uses the chosen status, even Rejected', async () => {
    finishedStatuses('Done', 'Rejected');
    expect(await jira({ done: 'Rejected' }).transition('WEB-418', { group: 'done' })).toMatchObject(
      { moved: true, to: 'Rejected', rule: 'setting' },
    );
    expect(jiraStatus('WEB-418')).toBe('Rejected');
  });

  it('uses the one status that is not a dropped one', async () => {
    finishedStatuses('Rejected', 'Shipped');
    expect(await jira().transition('WEB-418', { group: 'done' })).toMatchObject({
      moved: true,
      to: 'Shipped',
      rule: 'only_status',
    });
  });

  it('does not fall back when the workflow has no way to Done from here', async () => {
    finishedStatuses('Done', 'Closed');
    stubs.jira.closedTransitions.add('WEB:To Do>Done');
    expect(await jira().transition('WEB-418', { group: 'done' })).toMatchObject({
      moved: false,
      stopped: 'blocked',
      message:
        'WEB-418 was not moved: the Jira workflow does not allow moving it from To Do to Done.',
    });
    expect(jiraStatus('WEB-418')).toBe('To Do');
  });

  it('plans without moving, and moves to an exact name', async () => {
    finishedStatuses('Rejected', 'Done');
    expect(await jira().planMove('WEB-418', { group: 'done' })).toMatchObject({ to: 'Done' });
    expect(jiraStatus('WEB-418')).toBe('To Do');
    expect(await jira().transition('WEB-418', { name: 'rejected' })).toMatchObject({
      moved: true,
      to: 'Rejected',
      rule: 'exact',
    });
  });
});

describe('Jira: review and in-progress moves', () => {
  it('does not pick Blocked or guess between in-progress statuses', async () => {
    stubs.jira.workflows.WEB = {
      'To Do': 'new',
      Blocked: 'indeterminate',
      Building: 'indeterminate',
      Testing: 'indeterminate',
      Done: 'done',
    };
    expect(await jira().transition('WEB-418', { group: 'in_progress' })).toMatchObject({
      moved: false,
      message:
        'WEB-418 was not moved: this project has several in-progress statuses (Blocked, Building, Testing). Choose one in Settings → Connectors → Jira.',
    });
    expect(
      await jira({ in_progress: 'Building' }).transition('WEB-418', { group: 'in_progress' }),
    ).toMatchObject({ moved: true, to: 'Building' });
    expect(
      await jira({ in_progress: 'Building', in_review: 'Testing' }).transition('WEB-418', {
        group: 'in_review',
      }),
    ).toMatchObject({ moved: true, from: 'Building', to: 'Testing', status: 'in_review' });
    expect(
      await jira({ in_review: 'Testing' }).transition('WEB-418', { group: 'in_review' }),
    ).toMatchObject({ moved: false, stopped: 'unchanged' });
  });

  it('prefers a known review name and does not guess between others', async () => {
    stubs.jira.workflows.WEB = {
      'To Do': 'new',
      'In Progress': 'indeterminate',
      'Code Review': 'indeterminate',
      'Design review': 'indeterminate',
      Done: 'done',
    };
    expect(await jira().transition('WEB-418', { group: 'in_review' })).toMatchObject({
      moved: true,
      to: 'Code Review',
    });
    stubs.jira.workflows.API = {
      'To Do': 'new',
      'Design review': 'indeterminate',
      'QA review': 'indeterminate',
      Done: 'done',
    };
    expect(await jira().transition('API-77', { group: 'in_review' })).toMatchObject({
      moved: false,
      message:
        'API-77 was not moved: this project has several review statuses (Design review, QA review). Choose one in Settings → Connectors → Jira.',
    });
  });

  it('lists the statuses of a project', async () => {
    expect(await jira().projectStatuses('API')).toEqual([
      { name: 'To Do', kind: 'todo' },
      { name: 'Waiting for QA', kind: 'started' },
      { name: 'Done', kind: 'done' },
    ]);
  });
});

describe('Linear: the same rules', () => {
  const state = (key: string) => {
    const issue = stubs.linear.issues.find((item) => item.identifier === key)!;
    return stubs.linear.teams[issue.team]!.find((entry) => entry.id === issue.stateId)!.name;
  };

  it('goes to Done when Canceled comes first', async () => {
    const eng = stubs.linear.teams.ENG!;
    eng.unshift(
      ...eng.splice(
        eng.findIndex((entry) => entry.name === 'Canceled'),
        1,
      ),
    );
    expect(await linear().transition('ENG-12', { group: 'done' })).toMatchObject({
      moved: true,
      to: 'Done',
      rule: 'name',
    });
    expect(state('ENG-12')).toBe('Done');
  });

  it('does not move to Canceled when it is the only finished state', async () => {
    stubs.linear.teams.ENG = stubs.linear.teams.ENG!.filter((entry) => entry.name !== 'Done');
    expect(await linear().transition('ENG-12', { group: 'done' })).toMatchObject({
      moved: false,
      message:
        'ENG-12 was not moved: Spark never picks Canceled on its own. Choose a status in Settings → Connectors → Linear.',
    });
    expect(state('ENG-12')).toBe('Todo');
    expect(
      await linear({ done: 'Canceled' }).transition('ENG-12', { group: 'done' }),
    ).toMatchObject({ moved: true, to: 'Canceled', rule: 'setting' });
  });

  it('lists the states of a team', async () => {
    expect(await linear().projectStatuses('ops')).toEqual([
      { name: 'Todo', kind: 'todo' },
      { name: 'Doing', kind: 'started' },
      { name: 'Done', kind: 'done' },
    ]);
  });
});
