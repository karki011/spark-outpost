import { afterEach, describe, expect, it } from 'vitest';
import { APPROVAL_DECIDED, type RunEvent } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import { listen } from '../src/persistence/notifications.ts';
import { recordSessionSettings } from '../src/workflow/run-metadata.ts';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { pendingCard } from './spark-mcp-support.ts';
import { eventually, testDatabaseUrl } from './support.ts';

let h: AtlassianHarness;
const appended: RunEvent[] = [];

afterEach(async () => {
  appended.length = 0;
  if (h) await stopAtlassian(h);
});

async function runId(): Promise<string> {
  const { rows } = await h.t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE conversation_id = $1',
    [h.conversationId],
  );
  return rows[0]!.id;
}

async function switchTo(mode: string) {
  await recordSessionSettings(
    h.t.db,
    await runId(),
    { kind: 'session_settings', model: null, effort: null, mode, options: {} },
    async (event) => void appended.push(event),
  );
}

const decided = () =>
  [...appended, ...h.recorded.events].filter(
    (event) => 'name' in event && event.name === APPROVAL_DECIDED,
  );

describe('Spark action reads follow the mode the agent is in now', () => {
  it('lets a read waiting on a card go once the agent moves to Bypass permissions', async () => {
    h = await startAtlassian('/plan CP-51865', 'plan');
    const read = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    const card = await pendingCard(h.t);
    await switchTo('bypassPermissions');
    expect(evidence((await read).text).issue).toMatchObject({ key: 'WEB-418' });
    const settled = await getApproval(h.t.db, card.id);
    expect(settled).toMatchObject({ status: 'allowed', decidedBy: 'level' });
    expect(settled?.payload.sparkResult).toMatchObject({ state: 'done' });
    expect(decided()).toHaveLength(1);
    expect(JSON.stringify(h.recorded.audited)).toContain('ranWithoutReview');
  });

  it('announces the settled card so an open chat refetches its result', async () => {
    h = await startAtlassian('/plan CP-51865', 'plan');
    const changed: string[] = [];
    const listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
      const change = JSON.parse(payload) as { kind: string; conversationId: string | null };
      if (change.kind === 'approval' && change.conversationId === h.conversationId) {
        changed.push(change.kind);
      }
    });
    try {
      const read = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
      await pendingCard(h.t);
      await eventually(async () => changed.length > 0);
      changed.length = 0;
      await switchTo('bypassPermissions');
      await read;
      await eventually(async () => changed.length > 0);
    } finally {
      await listener.close();
    }
  });

  it('asks again after the agent moves back to a mode that asks', async () => {
    h = await startAtlassian('Read WEB-418', 'bypassPermissions');
    await h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    expect(await sparkCards(h.t)).toEqual([]);
    await switchTo('default');
    const read = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    await pendingCard(h.t);
    expect(await sparkCards(h.t)).toEqual(['pending']);
    h.recorded.stop();
    expect((await read).text).toContain('waiting');
  });

  it('keeps the card when the new mode still asks, and settles it only once', async () => {
    h = await startAtlassian('/plan CP-51865', 'plan');
    const read = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    await pendingCard(h.t);
    await switchTo('default');
    expect(await sparkCards(h.t)).toEqual(['pending']);
    await switchTo('auto');
    await switchTo('auto');
    await read;
    expect(await sparkCards(h.t)).toEqual(['allowed']);
    expect(decided()).toHaveLength(1);
  });

  it('never grants later reads in the chat from a card the mode cleared', async () => {
    h = await startAtlassian('/plan CP-51865', 'plan');
    const read = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    await pendingCard(h.t);
    await switchTo('bypassPermissions');
    await read;
    await switchTo('plan');
    const again = h.tools.call('spark_jira', { action: 'read', key: 'WEB-418' });
    await pendingCard(h.t);
    expect(await sparkCards(h.t)).toEqual(['allowed', 'pending']);
    h.recorded.stop();
    await again;
  });

  it('leaves a waiting change card for the user to answer', async () => {
    h = await startAtlassian('Look at WEB-418', 'default');
    const edit = await h.tools.call('spark_jira_edit', {
      action: 'update',
      key: 'WEB-418',
      summary: 'New title',
    });
    expect(edit.json()).toMatchObject({ outcome: 'waiting_for_user' });
    await switchTo('bypassPermissions');
    expect(await sparkCards(h.t)).toEqual(['pending']);
    expect(decided()).toHaveLength(0);
  });
});
