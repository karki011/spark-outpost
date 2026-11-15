import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chatKeptFolder } from '../src/chat-files/folders.ts';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { STORY_POINTS } from './fake-jira-work.ts';
import { confirmCard } from './spark-mcp-support.ts';

let h: AtlassianHarness;
let folders: string | null = null;

afterEach(async () => {
  if (h) await stopAtlassian(h);
  if (folders) await rm(folders, { recursive: true, force: true });
  folders = null;
});

const issue = (key: string) => h.stubs.jira.issues.find((item) => item.key === key)!;
const edit = (args: Record<string, unknown>) => h.tools.call('spark_jira_edit', args);
const read = async (args: Record<string, unknown>) =>
  evidence((await h.tools.call('spark_jira', args)).text);

async function lastAction() {
  const { rows } = await h.t.db.query<{ payload: { sparkAction: Record<string, unknown> } }>(
    `SELECT payload FROM approvals WHERE kind = 'spark_action' ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0]!.payload.sparkAction;
}

describe('spark_jira_edit update with people, estimates and any field', () => {
  it(
    'sets assignee by name, labels, estimates and fields by name, with rows on the card',
    { timeout: 60_000 },
    async () => {
      h = await startAtlassian('Tidy WEB-437', 'auto');
      const result = await edit({
        action: 'update',
        key: 'WEB-437',
        assignee: 'Alex',
        addLabels: ['ux'],
        originalEstimate: '3h',
        fields: { Components: ['Frontend'], 'Story point estimate': 5, duedate: '2026-12-01' },
      });
      expect(result.json()).toMatchObject({ outcome: 'done' });
      expect(issue('WEB-437')).toMatchObject({ assignee: 'acc-1' });
      expect(issue('WEB-437').labels).toContain('ux');
      expect(issue('WEB-437').extra).toMatchObject({
        components: [{ id: '1' }],
        [STORY_POINTS]: 5,
        duedate: '2026-12-01',
        timetracking: { originalEstimate: '3h' },
      });
      expect((await lastAction()).rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Assignee',
            before: 'Jordan Lee',
            after: 'Alex Example',
          }),
          expect.objectContaining({ label: 'Story point estimate', after: '5' }),
        ]),
      );
      expect(JSON.stringify(h.recorded.audited)).not.toContain('Alex Example');
    },
  );

  it('refuses a value the field does not allow, naming the choices', async () => {
    h = await startAtlassian('Set the component', 'auto');
    const refused = await edit({
      action: 'update',
      key: 'WEB-437',
      fields: { components: ['Mobile'] },
    });
    expect(refused.text).toContain('choose from Frontend, Backend');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('changes several issues on one card and rechecks each', async () => {
    h = await startAtlassian('Set due dates', 'default');
    await edit({
      action: 'update',
      keys: ['WEB-437', 'WEB-418'],
      fields: { duedate: '2026-12-24' },
    });
    const action = await lastAction();
    expect(action.targets).toEqual([expect.objectContaining({ key: 'WEB-418' })]);
    await confirmCard(h.t);
    expect(issue('WEB-437').extra).toMatchObject({ duedate: '2026-12-24' });
    expect(issue('WEB-418').extra).toMatchObject({ duedate: '2026-12-24' });
  });

  it('refuses fields across projects, since their values are per project', async () => {
    h = await startAtlassian('Set components', 'auto');
    const refused = await edit({
      action: 'update',
      keys: ['WEB-437', 'API-95'],
      fields: { components: ['Frontend'] },
    });
    expect(refused.text).toContain('one project at a time');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('removes an issue from its parent', async () => {
    h = await startAtlassian('Take WEB-437 out of its epic', 'auto');
    issue('WEB-437').parent = 'API-95';
    await edit({ action: 'update', key: 'WEB-437', parent: 'none' });
    expect(issue('WEB-437').parent).toBeNull();
  });
});

describe('spark_jira_edit work on an issue', () => {
  it('moves with a resolution and a comment from the move screen', async () => {
    h = await startAtlassian('Close WEB-437', 'auto');
    const moves = await read({ action: 'transitions', key: 'WEB-437' });
    expect(JSON.stringify(moves)).toContain('Resolution');
    await edit({
      action: 'transition',
      key: 'WEB-437',
      to: 'Done',
      resolution: "Won't Do",
      body: 'Dup',
    });
    expect(issue('WEB-437').status).toBe('Done');
    expect(issue('WEB-437').extra).toMatchObject({ resolution: { id: '2' } });
  });

  it('comments for a role only, links and unlinks, watches and votes', async () => {
    h = await startAtlassian('Work on WEB-437', 'auto');
    await edit({
      action: 'comment',
      key: 'WEB-437',
      body: 'Team only',
      visibility: { type: 'role', value: 'Developers' },
    });
    await edit({ action: 'link', key: 'WEB-437', linkType: 'blocks', otherKey: 'API-95' });
    await edit({ action: 'watch', key: 'WEB-437' });
    await edit({ action: 'vote', key: 'WEB-437' });
    const detail = await read({ action: 'read', key: 'WEB-437' });
    const issueRead = detail.issue as {
      links: { id: string; text: string }[];
      watchers: number;
      votes: number;
    };
    expect(issueRead.links).toEqual([{ id: expect.any(String), text: 'WEB-437 blocks API-95' }]);
    expect(issueRead).toMatchObject({ watchers: 1, votes: 1 });
    expect(detail.comments).toContainEqual(
      expect.objectContaining({ visibility: 'role Developers' }),
    );
    expect(h.stubs.jira.work.links[0]).toMatchObject({ inward: 'API-95', outward: 'WEB-437' });
    const unlinked = await edit({ action: 'unlink', key: 'WEB-437', id: issueRead.links[0]!.id });
    expect(unlinked.json()).toMatchObject({ message: 'Removed the link WEB-437 blocks API-95.' });
    expect(h.stubs.jira.work.links).toEqual([]);
  });

  it('logs, changes and deletes work, naming what was deleted, with a card in Manual', async () => {
    h = await startAtlassian('Log time', 'default');
    await edit({ action: 'log_work', key: 'WEB-437', timeSpent: '2h', body: 'Pairing' });
    await confirmCard(h.t);
    const id = h.stubs.jira.work.worklogs['WEB-437']![0]!.id;
    await edit({ action: 'edit_worklog', key: 'WEB-437', id, timeSpent: '3h' });
    await confirmCard(h.t);
    await edit({ action: 'delete_worklog', key: 'WEB-437', id });
    const card = await confirmCard(h.t);
    expect(card.options[0]!.name).toBe('Delete work log');
    expect(card.payload.sparkResult).toMatchObject({
      message: `Deleted work log ${id} (3h) on WEB-437.`,
    });
  });
});

describe('spark_jira attachments', () => {
  it('uploads a kept file, reads it back as text, refuses secret files and deletes it', async () => {
    folders = await mkdtemp(path.join(tmpdir(), 'spark-jira-'));
    h = await startAtlassian(
      'Attach the notes',
      'auto',
      [],
      undefined,
      {},
      { chatFolders: folders },
    );
    const kept = chatKeptFolder(folders, h.conversationId);
    await mkdir(kept, { recursive: true });
    await writeFile(path.join(kept, 'notes.txt'), 'hello from the chat');
    await writeFile(path.join(kept, '.env'), 'TOKEN=abc');
    const secret = await edit({ action: 'attach', key: 'WEB-437', path: path.join(kept, '.env') });
    expect(secret.text).toContain('secret file');
    const outside = await edit({ action: 'attach', key: 'WEB-437', path: '/etc/hosts' });
    expect(outside.isError).toBe(true);
    await edit({ action: 'attach', key: 'WEB-437', path: path.join(kept, 'notes.txt') });
    const file = h.stubs.jira.work.attachments[0]!;
    expect(file.data.toString()).toBe('hello from the chat');
    const text = await read({ action: 'attachment', id: file.id });
    expect(text).toMatchObject({ filename: 'notes.txt', text: 'hello from the chat' });
    expect(h.stubs.jira.work.mediaAuth).toEqual([null]);
    const removed = await edit({ action: 'delete_attachment', key: 'WEB-437', id: file.id });
    expect(removed.json()).toMatchObject({
      message: 'Deleted the attachment notes.txt from WEB-437.',
    });
  });
});

describe('spark_jira_edit sprints, versions and clones', () => {
  it('creates and starts a sprint, moves and ranks issues, then completes it', async () => {
    h = await startAtlassian('Plan the sprint', 'auto');
    expect(await read({ action: 'boards', project: 'WEB' })).toMatchObject({ boards: [{ id: 7 }] });
    const created = await edit({
      action: 'create_sprint',
      id: '7',
      name: 'Sprint 42',
      body: 'Ship it',
    });
    const sprintId = (created.json() as { sprintId: number }).sprintId;
    await edit({ action: 'sprint', id: String(sprintId), keys: ['WEB-437', 'WEB-418'] });
    expect(h.stubs.jira.work.agile.issueSprints).toMatchObject({
      'WEB-437': sprintId,
      'WEB-418': sprintId,
    });
    await edit({ action: 'rank', key: 'WEB-437', otherKey: 'WEB-418', to: 'before' });
    expect(h.stubs.jira.work.agile.ranks).toEqual([
      { key: 'WEB-437', other: 'WEB-418', after: false },
    ]);
    await edit({ action: 'backlog', key: 'WEB-418' });
    expect(h.stubs.jira.work.agile.issueSprints['WEB-418']).toBeNull();
    const started = await edit({
      action: 'start_sprint',
      id: String(sprintId),
      start: '2026-11-16',
      end: '2026-11-30',
    });
    expect(started.json()).toMatchObject({ message: 'Started Sprint 42.' });
    const sprints = await read({ action: 'sprints', id: '7' });
    expect(sprints).toMatchObject({ sprints: [{ name: 'Sprint 42', state: 'active' }] });
    await edit({ action: 'complete_sprint', id: String(sprintId) });
    expect(h.stubs.jira.work.agile.sprints[0]!.state).toBe('closed');
  });

  it('creates and releases a version and clones an issue with a link', async () => {
    h = await startAtlassian('Release', 'auto');
    const created = await edit({ action: 'create_version', project: 'WEB', name: '2.0' });
    const versionId = (created.json() as { versionId: string }).versionId;
    await edit({ action: 'release_version', id: versionId, end: '2026-11-20' });
    expect(h.stubs.jira.work.versions.find((entry) => entry.id === versionId)).toMatchObject({
      released: true,
    });
    const again = await edit({ action: 'release_version', id: versionId });
    expect(again.text).toContain('already released');
    const cloned = await edit({ action: 'clone', key: 'WEB-437' });
    const key = (cloned.json() as { key: string }).key;
    expect(issue(key).summary).toBe('CLONE - Uploads over 2 GB fail');
    expect(h.stubs.jira.work.links).toEqual([
      expect.objectContaining({ type: 'Cloners', inward: 'WEB-437', outward: key }),
    ]);
  });

  it('creates a ticket with fields by name from the create screen', async () => {
    h = await startAtlassian('File a bug', 'auto');
    const fields = await read({ action: 'fields', project: 'WEB', issueType: 'Bug' });
    expect(fields.fields).toContainEqual(expect.objectContaining({ id: STORY_POINTS }));
    const created = await h.tools.call('spark_create_ticket', {
      project: 'WEB',
      title: 'Crash',
      type: 'Bug',
      fields: { Components: ['Backend'], 'Story point estimate': 3 },
    });
    const key = (created.json() as { key: string }).key;
    expect(issue(key).extra).toMatchObject({ components: [{ id: '2' }], [STORY_POINTS]: 3 });
    expect((await lastAction()).fields).toEqual([
      expect.objectContaining({ name: 'Components', shown: 'Backend' }),
      expect.objectContaining({ name: 'Story point estimate', shown: '3' }),
    ]);
    expect(h.recordedObservations).toContain('Jira data (spark_create_ticket)');
  });

  it('looks up people, projects, fields and link types', async () => {
    h = await startAtlassian('Look around', 'auto');
    expect(await read({ action: 'users', query: 'jordan' })).toMatchObject({
      users: [{ accountId: 'acc-2', name: 'Jordan Lee' }],
    });
    expect(await read({ action: 'projects', query: '' })).toMatchObject({
      projects: expect.arrayContaining([expect.objectContaining({ key: 'WEB' })]),
    });
    expect(await read({ action: 'project', project: 'WEB' })).toMatchObject({
      components: [{ name: 'Frontend' }, { name: 'Backend' }],
    });
    const fields = await read({ action: 'fields', key: 'WEB-437' });
    expect(fields.fields).toContainEqual(
      expect.objectContaining({ id: 'components', allowed: ['Frontend', 'Backend'] }),
    );
    expect(await read({ action: 'link_types' })).toMatchObject({
      linkTypes: expect.arrayContaining([expect.objectContaining({ name: 'Blocks' })]),
    });
  });
});
