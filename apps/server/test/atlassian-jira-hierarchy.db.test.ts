import { afterEach, describe, expect, it } from 'vitest';
import { TEAM_PAYMENTS, TEAM_PLATFORM } from './fake-jira-meta.ts';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { confirmCard } from './spark-mcp-support.ts';

let h: AtlassianHarness;

afterEach(async () => {
  if (h) await stopAtlassian(h);
});

const issue = (key: string) => h.stubs.jira.issues.find((item) => item.key === key);

async function read(key: string) {
  const answer = await h.tools.call('spark_jira', { action: 'read', key });
  return evidence(answer.text).issue as Record<string, unknown>;
}

async function lastCard() {
  const { rows } = await h.t.db.query<{ payload: { sparkAction: Record<string, unknown> } }>(
    `SELECT payload FROM approvals WHERE kind = 'spark_action' ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0]!.payload.sparkAction;
}

function seedEpic() {
  issue('API-95')!.type = 'Epic';
  issue('WEB-418')!.team = TEAM_PLATFORM;
}

describe('Jira hierarchy and team through spark_* tools', () => {
  it('creates a story under an epic with its team, then sub-tasks, and reads them back', async () => {
    h = await startAtlassian('Plan the uploads epic', 'auto');
    seedEpic();
    const types = evidence(
      (await h.tools.call('spark_jira', { action: 'types', project: 'API' })).text,
    );
    expect(types.issueTypes).toContainEqual(
      expect.objectContaining({ name: 'Sub-task', subtask: true }),
    );
    expect(types.teamField).toBe('customfield_10001');
    expect(types.teamsSeen).toEqual([]);

    const story = await h.tools.call('spark_create_ticket', {
      project: 'API',
      title: 'Upload resume',
      type: 'Story',
      parent: 'API-95',
      team: TEAM_PLATFORM,
    });
    expect(story.json()).toMatchObject({ outcome: 'done' });
    const storyKey = (story.json() as { key: string }).key;
    expect(await lastCard()).toMatchObject({
      parent: 'API-95',
      team: { field: 'customfield_10001', id: TEAM_PLATFORM },
    });

    const subtask = await h.tools.call('spark_create_ticket', {
      project: 'API',
      title: 'Chunk the upload',
      type: 'Sub-task',
      parent: storyKey,
      team: 'platform',
    });
    const subtaskKey = (subtask.json() as { key: string }).key;

    expect(await read(storyKey)).toMatchObject({
      type: 'Story',
      parent: { key: 'API-95' },
      team: { id: TEAM_PLATFORM, name: 'Platform' },
      subtasks: [subtaskKey],
    });
    expect(await read(subtaskKey)).toMatchObject({
      type: 'Sub-task',
      parent: { key: storyKey, summary: 'Upload resume' },
      team: { id: TEAM_PLATFORM, name: 'Platform' },
    });
    const found = evidence(
      (await h.tools.call('spark_jira', { action: 'search', jql: 'project = "API"' })).text,
    );
    expect(found.found).toContainEqual(
      expect.objectContaining({
        key: subtaskKey,
        parent: storyKey,
        team: expect.objectContaining({ id: TEAM_PLATFORM }),
      }),
    );
  });

  it('passes on Jira’s own reason when a sub-task has no parent', async () => {
    h = await startAtlassian('Add a sub-task', 'auto');
    const refused = await h.tools.call('spark_create_ticket', {
      project: 'API',
      title: 'Orphan',
      type: 'Sub-task',
    });
    expect(refused.text).toContain(
      'parent: Issue type is a sub-task but parent issue key or id not specified.',
    );
  });

  it('refuses a team name it cannot match and lists the teams it saw', async () => {
    h = await startAtlassian('Create it', 'auto');
    seedEpic();
    const refused = await h.tools.call('spark_create_ticket', {
      project: 'WEB',
      title: 'New',
      team: 'Nobody',
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`Platform (${TEAM_PLATFORM})`);
    expect(h.recordedObservations).toContain('Jira data (spark_create_ticket)');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('refuses parent and team for Linear before any card', async () => {
    h = await startAtlassian('Create it', 'auto');
    const refused = await h.tools.call('spark_create_ticket', {
      source: 'linear',
      project: 'ENG',
      title: 'New',
      parent: 'ENG-1',
    });
    expect(refused.text).toContain('only for Jira tickets');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('moves an issue under a parent, changes its type and team, with before and after on the card', async () => {
    h = await startAtlassian('Put API-96 under the epic', 'default');
    seedEpic();
    issue('API-95')!.team = TEAM_PAYMENTS;
    const target = h.stubs.jira.issues.find(
      (item) => item.key.startsWith('API-') && item.key !== 'API-95',
    )!;
    const waiting = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: target.key,
      parent: 'api-95',
      issueType: 'Story',
      team: 'Payments',
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(await lastCard()).toMatchObject({
      changes: {
        parent: 'API-95',
        issueType: 'Story',
        team: { id: TEAM_PAYMENTS, name: 'Payments' },
      },
      before: { parent: null, type: 'Task', team: null },
      after: { parent: 'API-95', type: 'Story', team: 'Payments' },
    });
    await confirmCard(h.t);
    expect(issue(target.key)).toMatchObject({
      parent: 'API-95',
      type: 'Story',
      team: TEAM_PAYMENTS,
    });
    expect(JSON.stringify(h.recorded.audited)).not.toContain('Payments');
  });

  it('returns Jira’s reason when it refuses a type change', async () => {
    h = await startAtlassian('Make WEB-418 a sub-task', 'auto');
    const refused = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-418',
      issueType: 'Sub-task',
    });
    expect(refused.text).toContain(
      'issuetype: Changing between sub-task and standard issue types is not supported.',
    );
    expect(issue('WEB-418')!.type).toBeUndefined();
  });
});
