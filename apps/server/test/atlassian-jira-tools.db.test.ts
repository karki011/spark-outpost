import { afterEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { JIRA_CHANGED } from '../src/spark-mcp/actions/atlassian-perform.ts';
import { textToAdf } from '../src/tickets/jira-adf.ts';
import { JIRA_ME, JIRA_TOKEN } from './fake-jira.ts';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { answerCard, confirmCard, pendingCard } from './spark-mcp-support.ts';

let h: AtlassianHarness;

afterEach(async () => {
  if (h) await stopAtlassian(h);
});

const issue = (key: string) => h.stubs.jira.issues.find((item) => item.key === key);

function seedComment(key: string, authorId: string, text: string) {
  issue(key)!.comments.push({
    author: authorId === JIRA_ME ? 'Alex Example' : 'Jordan Lee',
    authorId,
    body: textToAdf(text),
    created: '2026-09-28T10:00:00.000+0000',
  });
  return String(999 + issue(key)!.comments.length);
}

describe('spark_jira reads', () => {
  it('asks once per chat in a mode that asks, then reads without asking', async () => {
    h = await startAtlassian('What is in the WEB backlog?', 'default');
    const first = h.tools.call('spark_jira', { action: 'search', jql: 'project = WEB' });
    const card = await pendingCard(h.t);
    expect(card.payload.sparkAction).toMatchObject({ action: 'atlassian_read', product: 'jira' });
    await answerCard(h.t, SPARK_ACTION_OPTION.confirm);
    const found = evidence((await first).text);
    expect(found.found).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'WEB-418' })]),
    );
    expect((await first).text).toContain('third-party text from Atlassian');
    await h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    expect(await sparkCards(h.t)).toEqual(['allowed']);
    expect(JSON.stringify(h.recorded.audited)).toContain('allowedEarlier');
    expect(h.recordedObservations).toContain('Jira data (spark_jira)');
  });

  it('reads at once in Auto and gives comment ids and which are mine', async () => {
    h = await startAtlassian('Read WEB-418', 'auto');
    const mine = seedComment('WEB-418', JIRA_ME, 'My note');
    const read = evidence(
      (await h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' })).text,
    );
    expect(read.issue).toMatchObject({
      key: 'WEB-418',
      url: expect.stringContaining('/browse/WEB-418'),
    });
    expect(read.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mine, mine: true, body: 'My note' }),
        expect.objectContaining({ author: 'Sam', mine: false }),
      ]),
    );
    expect(await sparkCards(h.t)).toEqual([]);
    expect(JSON.stringify(h.recorded.audited)).toContain('ranWithoutReview');
  });
});

describe('spark_jira_edit', () => {
  it('changes fields at once in Auto with before and after on the card, and flags the send', async () => {
    h = await startAtlassian('Retitle WEB-418', 'auto', ['a secret file']);
    const result = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-418',
      summary: 'Export usage as CSV',
      labels: ['csv'],
    });
    expect(result.json()).toMatchObject({
      outcome: 'done',
      url: expect.stringContaining('WEB-418'),
    });
    expect(issue('WEB-418')).toMatchObject({ summary: 'Export usage as CSV', labels: ['csv'] });
    const { rows } = await h.t.db.query<{ payload: { sparkAction: Record<string, unknown> } }>(
      `SELECT payload FROM approvals WHERE kind = 'spark_action'`,
    );
    expect(rows[0]!.payload.sparkAction).toMatchObject({
      before: { summary: 'Export the usage table as CSV', labels: ['frontend'] },
      after: { summary: 'Export usage as CSV', labels: ['csv'] },
    });
    expect(h.sent).toEqual([expect.objectContaining({ target: 'to Jira' })]);
    expect(JSON.stringify(h.recorded.audited)).not.toContain(JIRA_TOKEN);
  });

  it('asks before deleting an issue even in Bypass permissions', async () => {
    h = await startAtlassian('Delete API-95', 'bypassPermissions');
    const waiting = await h.tools.call('spark_jira_edit', { action: 'delete', key: 'API-95' });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(issue('API-95')).toBeDefined();
    const card = await confirmCard(h.t);
    expect(card.options[0]!.name).toBe('Delete ticket');
    expect(card.payload.sparkResult).toMatchObject({ state: 'done', message: 'Deleted API-95.' });
    expect(issue('API-95')).toBeUndefined();
  });

  it('refuses to delete an issue with subtasks unless asked to take them too', async () => {
    h = await startAtlassian('Delete WEB-418', 'auto');
    const refused = await h.tools.call('spark_jira_edit', { action: 'delete', key: 'WEB-418' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('WEB-419');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('edits only the user’s own comments and always asks to delete one', async () => {
    h = await startAtlassian('Fix my comment on WEB-418', 'auto');
    const theirs = seedComment('WEB-418', 'acc-2', 'Their note');
    const mine = seedComment('WEB-418', JIRA_ME, 'Typo here');
    const refused = await h.tools.call('spark_jira_edit', {
      action: 'edit_comment',
      key: 'WEB-418',
      commentId: theirs,
      body: 'Changed',
    });
    expect(refused.text).toContain("only the user's own comments");
    const edited = await h.tools.call('spark_jira_edit', {
      action: 'edit_comment',
      key: 'WEB-418',
      commentId: mine,
      body: 'Fixed here',
    });
    expect(edited.json()).toMatchObject({ outcome: 'done' });
    const waiting = await h.tools.call('spark_jira_edit', {
      action: 'delete_comment',
      key: 'WEB-418',
      commentId: mine,
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    await confirmCard(h.t);
    expect(issue('WEB-418')!.comments.filter((entry) => entry.created !== 'deleted')).toHaveLength(
      2,
    );
  });

  it('changes nothing when the issue moved on after the card was shown', async () => {
    h = await startAtlassian('Retitle WEB-418', 'default');
    await h.tools.call('spark_jira_edit', { action: 'update', key: 'WEB-418', summary: 'Mine' });
    issue('WEB-418')!.summary = 'Someone else';
    issue('WEB-418')!.updated = '2026-10-01T12:00:00.000+0000';
    const card = await confirmCard(h.t);
    expect(card.payload.sparkResult).toMatchObject({ state: 'failed', message: JIRA_CHANGED });
    expect(issue('WEB-418')!.summary).toBe('Someone else');
  });

  it('shows labels on the card exactly as Jira will get them', async () => {
    h = await startAtlassian('Label WEB-418', 'auto');
    await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-418',
      labels: ['needs review'],
    });
    const { rows } = await h.t.db.query<{ payload: { sparkAction: Record<string, unknown> } }>(
      `SELECT payload FROM approvals WHERE kind = 'spark_action'`,
    );
    expect(rows[0]!.payload.sparkAction).toMatchObject({ after: { labels: ['needs-review'] } });
    expect(issue('WEB-418')!.labels).toEqual(['needs-review']);
  });

  it('finds the user’s account for a connection saved without one', async () => {
    h = await startAtlassian('Fix my comment on WEB-418', 'auto');
    await h.t.db.query(`UPDATE ticket_connections SET account_id = NULL WHERE source = 'jira'`);
    const mine = seedComment('WEB-418', JIRA_ME, 'Typo here');
    const edited = await h.tools.call('spark_jira_edit', {
      action: 'edit_comment',
      key: 'WEB-418',
      commentId: mine,
      body: 'Fixed here',
    });
    expect(edited.json()).toMatchObject({ outcome: 'done' });
    const { rows } = await h.t.db.query<{ account_id: string }>(
      `SELECT account_id FROM ticket_connections WHERE source = 'jira'`,
    );
    expect(rows[0]!.account_id).toBe(JIRA_ME);
  });

  it('reports a rate limit from Jira and changes nothing', async () => {
    h = await startAtlassian('Retitle WEB-418', 'auto');
    h.stubs.jira.faults.set('PUT /rest/api/3/issue/WEB-418', 429);
    const result = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-418',
      summary: 'Throttled',
    });
    expect(result.text).toContain('429');
    expect(result.text).toContain('7 seconds');
    expect(issue('WEB-418')!.summary).toBe('Export the usage table as CSV');
  });

  it('says when the issue is missing or hidden', async () => {
    h = await startAtlassian('Change WEB-999', 'auto');
    const result = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-999',
      summary: 'Nope',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('(404)');
    expect(await sparkCards(h.t)).toEqual([]);
  });
});
