import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type Teammate } from '@spark-outpost/contracts';
import { DRAFT_REPLACED } from '../src/crew/crew-drafts.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import { recordObservation } from '../src/persistence/observations.ts';
import { listTeammates } from '../src/persistence/teammates.ts';
import { useCrewTools } from './spark-crew-harness.ts';
import {
  answerCard,
  cardResult,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { startChat, type TestDb } from './support.ts';

const crew = useCrewTools();
const { call } = crew;
let t: TestDb;
let chat: { conversationId: string; runId: string };
let scout: Teammate;

beforeEach(() => {
  ({ t, chat, scout } = crew.state());
});

const pendingIds = async (conversationId?: string) => {
  const { rows } = await t.db.query<{ id: string }>(
    `SELECT a.id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE a.kind = 'spark_action' AND a.status = 'pending'
       AND ($1::uuid IS NULL OR r.conversation_id = $1) ORDER BY a.created_at`,
    [conversationId ?? null],
  );
  return rows.map((row) => row.id);
};

const lookStep = () => ({
  id: 'look',
  sparkId: scout.id,
  prompt: '',
  dependsOn: [],
  join: 'all' as const,
  onFailure: 'stop' as const,
});

const readWeb = () =>
  recordObservation(t.db, chat.runId, { source: 'web_page', label: 'web page (example.com)' });

describe('the card follows the agent’s mode unless the turn read untrusted data', () => {
  it('adds a Spark at once in Auto after reading only the crew', async () => {
    await crew.setRun('auto');
    await call('spark_sparks');
    await call('spark_crew');
    const result = await call('spark_create_spark', { name: 'Wren', role: 'Docs' });
    expect(result.facts.outcome).toBe('done');
    expect((await listTeammates(t.db, t.workspaceId)).map((spark) => spark.name)).toContain('Wren');
  });

  it('shows a card naming the read after the turn read a web page', async () => {
    await crew.setRun('auto');
    await readWeb();
    await call('spark_sparks');
    const result = await call('spark_create_spark', { name: 'Wren' });
    expect(result.facts.outcome).toBe('waiting_for_user');
    const [id] = await pendingIds();
    expect((await getApproval(t.db, id!))!.payload.observed).toEqual(['web page (example.com)']);
  });

  it('adds a Spark at once in Bypass permissions even after a web read', async () => {
    await crew.setRun('bypassPermissions');
    await readWeb();
    const result = await call('spark_create_spark', { name: 'Wren' });
    expect(result.facts.outcome).toBe('done');
  });

  it('refuses a Spark change from a child run, even in Bypass permissions', async () => {
    await crew.setRun('bypassPermissions');
    const parent = await startChat(t, 'Parent turn');
    await t.db.query("UPDATE runs SET parent_run_id = $2, role = 'spark' WHERE id = $1", [
      chat.runId,
      parent.runId,
    ]);
    const result = await call('spark_update_spark', { spark: 'Scout', delete: true });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Only the chat’s own turn');
    expect(await listTeammates(t.db, t.workspaceId)).toHaveLength(1);
  });

  it('shows a card in Auto for a pull request follow-up turn', async () => {
    await crew.setRun('auto', 'pr_follow_up');
    const result = await call('spark_create_spark', { name: 'Wren' });
    expect(result.facts.outcome).toBe('waiting_for_user');
  });

  it.each(['assistant', 'workflow'])(
    'shows a card in Auto for a turn %s started',
    async (source) => {
      await crew.setRun('auto', source);
      const result = await call('spark_update_spark', { spark: 'Scout', role: 'Reviewer' });
      expect(result.facts.outcome).toBe('waiting_for_user');
    },
  );
});

describe('drafts', () => {
  let other: { conversationId: string; runId: string };
  let otherTools: SparkToolsHarness;
  let otherHooks: RecordedHooks;

  beforeEach(async () => {
    other = await startChat(t, 'Make a docs Spark');
    await t.db.query(
      `UPDATE runs SET provider = 'claude', agent_mode = 'default', used_mode = 'default',
         source = 'ui' WHERE id = $1`,
      [other.runId],
    );
    otherHooks = recordedHooks();
    otherTools = await startSparkTools(t, {
      conversationId: other.conversationId,
      runId: other.runId,
      actions: otherHooks.hooks,
    });
  });

  afterEach(async () => {
    otherHooks.stop();
    await otherTools.close();
  });

  it('replaces its own draft of the same Spark, and Allow on the old card is refused', async () => {
    const first = await call('spark_create_spark', { name: 'Wren', role: 'Docs' });
    const second = await call('spark_create_spark', { name: ' wren ', role: 'Writer' });
    expect(second.facts).toMatchObject({ outcome: 'waiting_for_user', replacedDrafts: 1 });
    expect(await pendingIds()).toEqual([second.facts.approvalId]);
    const old = await getApproval(t.db, first.facts.approvalId as string);
    expect(old).toMatchObject({ status: 'cancelled', note: DRAFT_REPLACED });
    await expect(
      decideApproval(t.db, t.workspaceId, old!.id, {
        optionId: SPARK_ACTION_OPTION.confirm,
        scope: 'once',
      }),
    ).rejects.toThrow();
  });

  it('refuses a name a saved Spark or another chat’s draft already has', async () => {
    const saved = await call('spark_create_spark', { name: 'SCOUT' });
    expect(saved.isError).toBe(true);
    expect(saved.text).toContain('already a Spark named Scout');
    await otherTools.call('spark_create_spark', { name: 'Wren' });
    const clash = await call('spark_create_spark', { name: 'Wren' });
    expect(clash.text).toContain('waiting for the user in another chat');
    const rename = await call('spark_update_spark', { spark: 'Scout', name: 'wren' });
    expect(rename.text).toContain('waiting for the user in another chat');
  });

  it('lists drafts, with content only for its own, and withdraws only its own', async () => {
    await call('spark_create_spark', { name: 'Wren', instructions: 'Short.' });
    await otherTools.call('spark_create_spark', { name: 'Ada', instructions: 'Secret plan.' });
    const listed = await call('spark_sparks');
    expect(listed.facts.drafts).toEqual([
      expect.objectContaining({ name: 'Wren', chat: 'this chat', instructions: 'Short.' }),
      { draftId: expect.any(String), kind: 'new Spark', name: 'Ada', chat: 'another chat' },
    ]);
    const [otherId] = await pendingIds(other.conversationId);
    const withdrawn = await call('spark_crew_edit', { withdraw: [otherId] });
    expect(withdrawn.facts).toMatchObject({ withdrawn: 0, notFound: [otherId] });
    expect((await call('spark_crew_edit', { withdraw: ['all'] })).facts.withdrawn).toBe(1);
    expect(await pendingIds()).toEqual([otherId]);
  });

  it('refuses a workflow name another workflow or draft has', async () => {
    const steps = [{ id: 'look', spark: 'Scout' }];
    await workflowStore().save(
      { id: 'nightly', name: 'Nightly', steps: [lookStep()] },
      null,
      new Set([scout.id]),
    );
    const saved = await call('spark_crew_edit', {
      workflow: { id: 'late', name: 'nightly', steps },
    });
    expect(saved.text).toContain('already named Nightly');
    await otherTools.call('spark_crew_edit', { workflow: { id: 'weekly', name: 'Weekly', steps } });
    const draft = await call('spark_crew_edit', {
      workflow: { id: 'week', name: 'Weekly', steps },
    });
    expect(draft.text).toContain('waiting for the user in another chat');
    await call('spark_crew_edit', { workflow: { id: 'daily', name: 'Daily', steps } });
    const own = await call('spark_crew_edit', { workflow: { id: 'day', name: 'daily', steps } });
    expect(own.text).toContain('waiting for the user in this chat');
  });

  it('refuses a rename to a name its own new-Spark draft has', async () => {
    await call('spark_create_spark', { name: 'Wren' });
    const rename = await call('spark_update_spark', { spark: 'Scout', name: 'Wren' });
    expect(rename.text).toContain('waiting for the user in this chat');
  });

  it('treats "all" as every draft only when it is the only id', async () => {
    await call('spark_create_spark', { name: 'Wren' });
    const mixed = await call('spark_crew_edit', { withdraw: ['all', 'nope'] });
    expect(mixed.facts).toMatchObject({ withdrawn: 0, notFound: ['all', 'nope'] });
    expect(await pendingIds()).toHaveLength(1);
  });
});

describe('deleting a Spark', () => {
  it('deletes at once in Auto and names it', async () => {
    await crew.setRun('auto');
    const result = await call('spark_update_spark', { spark: 'Scout', delete: true });
    expect(result.facts).toMatchObject({
      outcome: 'done',
      message: 'Deleted the Scout Spark and its files.',
    });
    expect(await listTeammates(t.db, t.workspaceId)).toEqual([]);
  });

  it('refuses on Allow when a workflow started using it after the card', async () => {
    await call('spark_update_spark', { spark: 'Scout', delete: true });
    await workflowStore().save(
      { id: 'nightly', name: 'Nightly', steps: [lookStep()] },
      null,
      new Set([scout.id]),
    );
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const failed = (await cardResult(t, card.id)).payload.sparkResult!;
    expect(failed.state).toBe('failed');
    expect(failed.message).toContain('Scout is a step in Nightly');
    expect(await listTeammates(t.db, t.workspaceId)).toHaveLength(1);
  });

  it('refuses while a workflow uses it', async () => {
    await workflowStore().save(
      { id: 'nightly', name: 'Nightly', steps: [lookStep()] },
      null,
      new Set([scout.id]),
    );
    const result = await call('spark_update_spark', { spark: 'Scout', delete: true });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Scout is a step in Nightly');
  });

  it('asks in Manual with a delete card', async () => {
    const result = await call('spark_update_spark', { spark: 'Scout', delete: true });
    expect(result.facts.outcome).toBe('waiting_for_user');
    const [id] = await pendingIds();
    expect((await getApproval(t.db, id!))!.title).toBe('Delete the Scout Spark?');
  });
});

describe('separate changes stay separate drafts', () => {
  it('keeps two skills proposed in two calls both waiting', async () => {
    const skill = (name: string) => ({
      spark: 'Scout',
      files: [
        {
          path: `skills/${name}/SKILL.md`,
          text: `---\nname: ${name}\ndescription: Does ${name}\n---\nSteps.\n`,
        },
      ],
    });
    await call('spark_crew_edit', skill('notes'));
    const second = await call('spark_crew_edit', skill('triage'));
    expect(second.facts.replacedDrafts).toBeUndefined();
    expect(await pendingIds()).toHaveLength(2);
  });

  it('keeps a rename and an instructions change both waiting', async () => {
    await call('spark_update_spark', { spark: 'Scout', name: 'Scouter' });
    await call('spark_update_spark', { spark: 'Scout', instructions: 'Be kind.' });
    expect(await pendingIds()).toHaveLength(2);
  });
});

describe('Ask Spark', () => {
  it('always gets a card, even set to Act', async () => {
    await crew.setRun('auto');
    await t.db.query(
      `UPDATE profiles SET assistant_acts = 'act', assistant_conversation_id = $2
       WHERE workspace_id = $1`,
      [t.workspaceId, chat.conversationId],
    );
    const tools = await startSparkTools(t, {
      conversationId: chat.conversationId,
      runId: chat.runId,
      actions: recordedHooks().hooks,
      assistant: true,
    });
    try {
      const result = await tools.call('spark_create_spark', { name: 'Wren' });
      expect(result.json<{ outcome: string }>().outcome).toBe('waiting_for_user');
    } finally {
      await tools.close();
    }
  });
});
