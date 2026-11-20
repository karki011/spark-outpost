import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAutoTitle, recordSuggestedTitle } from '../src/persistence/auto-title.ts';
import { updateConversation } from '../src/persistence/conversation-actions.ts';
import {
  createConversation,
  getSummary,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import {
  approvePlanDocument,
  insertPlanDocument,
  rejectPlanDocument,
} from '../src/persistence/plan-documents.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function chat(): Promise<{ id: string; runId: string }> {
  const id = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  const sent = await sendUserMessage(
    t.db,
    id,
    { id: randomUUID(), content: 'Add a dark mode to the settings page' },
    { provider: 'scripted' },
  );
  return { id, runId: sent.run.id };
}

async function propose(conversationId: string, runId: string, body: string) {
  return insertPlanDocument(t.db, {
    conversationId,
    taskId: null,
    source: 'claude_plan_mode',
    body,
    sourceRunId: runId,
  });
}

const approval = (runId: string) => ({
  by: 'user' as const,
  option: 'exit-plan-default',
  runId,
  commit: null,
});

async function titleOf(id: string) {
  const summary = await getSummary(t.db, id);
  return { title: summary?.title, source: summary?.titleSource };
}

describe('a chat titled from its agreed plan', () => {
  it('takes the plan title when the plan is approved', async () => {
    const { id, runId } = await chat();
    const plan = await propose(id, runId, '# Plan: Dark mode for Settings\n\n1. Add tokens');
    expect((await titleOf(id)).title).toBe('Add a dark mode to the settings page');
    await approvePlanDocument(t.db, plan.id, approval(runId));
    expect(await titleOf(id)).toEqual({ title: 'Dark mode for Settings', source: 'auto' });
  });

  it('keeps a plan title that matches the message title through the end of the turn', async () => {
    const { id, runId } = await chat();
    await t.db.query(`UPDATE runs SET category = 'build' WHERE id = $1`, [runId]);
    const plan = await propose(id, runId, '# Add a dark mode to the settings page');
    await approvePlanDocument(t.db, plan.id, approval(runId));
    expect((await titleOf(id)).source).toBe('auto');
    await recordSuggestedTitle(t.db, runId, 'Settings theme work');
    await applyAutoTitle(t.db, runId);
    expect((await titleOf(id)).title).toBe('Add a dark mode to the settings page');
  });

  it('changes nothing for a rejected plan', async () => {
    const { id, runId } = await chat();
    const plan = await propose(id, runId, '# Dark mode for Settings');
    await rejectPlanDocument(t.db, plan.id, null);
    expect((await titleOf(id)).source).toBe('message');
  });

  it('never replaces a name the user gave, before or after approval', async () => {
    const { id, runId } = await chat();
    await updateConversation(t.db, t.workspaceId, id, { title: 'My settings work' });
    const first = await propose(id, runId, '# Dark mode for Settings');
    await approvePlanDocument(t.db, first.id, approval(runId));
    expect(await titleOf(id)).toEqual({ title: 'My settings work', source: 'user' });

    const other = await chat();
    const plan = await propose(other.id, other.runId, '# Dark mode for Settings');
    await approvePlanDocument(t.db, plan.id, approval(other.runId));
    await updateConversation(t.db, t.workspaceId, other.id, { title: 'Renamed later' });
    const next = await propose(other.id, other.runId, '# Light mode too');
    await approvePlanDocument(t.db, next.id, approval(other.runId));
    expect(await titleOf(other.id)).toEqual({ title: 'Renamed later', source: 'user' });
  });

  it('retitles again when a newer plan is approved', async () => {
    const { id, runId } = await chat();
    await insertPlanDocument(t.db, {
      conversationId: id,
      taskId: null,
      source: 'claude_plan_mode',
      body: '# Dark mode for Settings',
      sourceRunId: runId,
      approval: approval(runId),
    });
    expect((await titleOf(id)).title).toBe('Dark mode for Settings');
    const next = await propose(id, runId, '# Dark and high-contrast modes');
    await approvePlanDocument(t.db, next.id, approval(runId));
    expect((await titleOf(id)).title).toBe('Dark and high-contrast modes');
  });

  it('keeps the plan title when the turn ends with its own title line', async () => {
    const { id, runId } = await chat();
    await t.db.query(`UPDATE runs SET category = 'build' WHERE id = $1`, [runId]);
    const plan = await propose(id, runId, '# Dark mode for Settings');
    await approvePlanDocument(t.db, plan.id, approval(runId));
    await recordSuggestedTitle(t.db, runId, 'Settings theme work');
    await applyAutoTitle(t.db, runId);
    expect((await titleOf(id)).title).toBe('Dark mode for Settings');
  });
});
