import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Teammate } from '@spark-outpost/contracts';
import { CREW_EDIT_REFUSALS, CREW_READ_REFUSALS } from '../src/crew/tool-offer.ts';
import { macOnlyCard } from '../src/remote/policy.ts';
import { ASK_SPARK_REFUSALS, cardRefusal } from '../src/spark-mcp/actions/ask-spark-limits.ts';
import { EVERYTHING_AVAILABLE, sparkAvailability } from '../src/spark-mcp/availability.ts';
import { sparkToolsFor } from '../src/spark-mcp/server.ts';
import { NOTES_SKILL, useCrewTools } from './spark-crew-harness.ts';
import { pendingCard, toolDeps } from './spark-mcp-support.ts';
import { startChat, type TestDb } from './support.ts';

const crew = useCrewTools();
const { call } = crew;
let t: TestDb;
let chat: { conversationId: string; runId: string };
let scout: Teammate;

beforeEach(() => {
  ({ t, chat, scout } = crew.state());
});

const edit = (args: Record<string, unknown>) => call('spark_crew_edit', args);
const read = (args: Record<string, unknown> = {}) => call('spark_crew', args);

async function cardCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM approvals WHERE kind = 'spark_action'`,
  );
  return rows[0]!.count;
}

describe('who is offered the crew tools', () => {
  const turn = () => ({
    workspaceId: t.workspaceId,
    conversationId: chat.conversationId,
    runId: chat.runId,
  });
  const offered = async (scope: Record<string, unknown> = {}) => {
    const available = await sparkAvailability(toolDeps(t), { ...turn(), ...scope });
    const names = sparkToolsFor({ ...turn(), ...scope }, available).map((tool) => tool.name);
    return {
      read: names.includes('spark_crew'),
      edit: names.includes('spark_crew_edit'),
      howTo: available.howTo?.crew_read,
    };
  };

  it('offers both to a typed chat turn on the Mac', async () => {
    expect(await offered()).toEqual({ read: true, edit: true, howTo: undefined });
  });

  it('offers Ask Spark and a read-only turn the read tool only', async () => {
    expect(await offered({ assistant: true, readOnly: true })).toMatchObject({
      read: true,
      edit: false,
    });
    expect(await offered({ readOnly: true })).toMatchObject({ read: true, edit: false });
    const names = sparkToolsFor({ assistant: true }, EVERYTHING_AVAILABLE).map((tool) => tool.name);
    expect(names).toContain('spark_crew');
    expect(names).not.toContain('spark_crew_edit');
  });

  it('offers neither to a spoken run and refuses a call anyway', async () => {
    await crew.setRun('bypassPermissions', 'voice');
    const spoken = await offered();
    expect(spoken).toMatchObject({ read: false, edit: false });
    expect(spoken.howTo).toContain('never for a spoken message');
    expect((await read()).text).toContain(CREW_READ_REFUSALS.voice);
    expect((await edit(NOTES_SKILL)).text).toContain(CREW_EDIT_REFUSALS.voice);
  });

  it('offers neither to a run from a paired device', async () => {
    const device = randomUUID();
    await t.db.query(
      `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, 'Phone', $3)`,
      [device, t.workspaceId, 'a'.repeat(64)],
    );
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [chat.runId, device]);
    const remote = await offered();
    expect(remote).toMatchObject({ read: false, edit: false });
    expect(remote.howTo).toContain('paired device');
    expect((await read()).text).toContain(CREW_READ_REFUSALS.remote);
    expect((await edit(NOTES_SKILL)).text).toContain(CREW_EDIT_REFUSALS.remote);
  });

  it('offers neither to a child run or a workflow step', async () => {
    const parent = await startChat(t, 'Run the nightly workflow');
    await t.db.query(
      `UPDATE runs SET parent_run_id = $2, role = 'spark', route = $3 WHERE id = $1`,
      [chat.runId, parent.runId, JSON.stringify({ spark: { id: scout.id, step: 'look' } })],
    );
    const step = await offered();
    expect(step).toMatchObject({ read: false, edit: false });
    expect(step.howTo).toContain('workflow step');
    expect((await read()).text).toContain(CREW_READ_REFUSALS.child);
    expect((await edit(NOTES_SKILL)).text).toContain(CREW_EDIT_REFUSALS.child);
    expect(await cardCount()).toBe(0);
  });
});

describe('creating or changing a Spark itself', () => {
  it('asks in every mode and names a similar Spark', async () => {
    const result = await call('spark_create_spark', { name: 'Scouts', instructions: 'Review.' });
    expect(result.facts.outcome).toBe('waiting_for_user');
    const card = await pendingCard(t);
    expect(card.payload.sparkAction).toMatchObject({
      action: 'create_teammate',
      similar: [{ kind: 'spark', name: 'Scout', reason: 'similar_name' }],
    });
    expect(macOnlyCard(card.payload)).toBe(true);
    const chatRow = { id: chat.conversationId, title: 'Chat', terminal: false };
    expect(cardRefusal(card, chatRow, null)).toBe(ASK_SPARK_REFUSALS.crew);
  });

  it('shows the instructions a change replaces', async () => {
    const result = await call('spark_update_spark', { spark: 'Scout', instructions: 'Be kind.' });
    expect(result.facts.outcome).toBe('waiting_for_user');
    expect((await pendingCard(t)).payload.sparkAction).toMatchObject({
      action: 'update_teammate',
      instructions: 'Be kind.',
      instructionsBefore: 'Be brief.',
    });
  });
});
