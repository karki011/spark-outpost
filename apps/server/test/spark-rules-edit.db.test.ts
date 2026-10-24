import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULES_SESSION_OPTION, SPARK_ACTION_OPTION, type Approval } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import { saveSparkRules } from '../src/persistence/spark-rules.ts';
import { RULES_RUN_REFUSALS } from '../src/spark-mcp/actions/rules-edit-session.ts';
import { OUTSIDE_CHANGE_REFUSAL, sparkRulesFiles } from '../src/spark-rules/rules-store.ts';
import {
  answerCard,
  cardResult,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let tools: SparkToolsHarness;
let recorded: RecordedHooks;
let chat: { conversationId: string; runId: string };

const RELEASE = { add: [{ effect: 'allow', rule: 'Gh(release create)' }] };
const ISSUES = { add: [{ effect: 'allow', rule: 'Gh(issue create)' }] };

async function setRun(provider: string, mode: string, origin = 'ui'): Promise<void> {
  await t.db.query(
    'UPDATE runs SET provider = $2, agent_mode = $3, used_mode = $3, source = $4 WHERE id = $1',
    [chat.runId, provider, mode, origin],
  );
}

async function openSession(provider = 'claude', sessionId = randomUUID()): Promise<string> {
  await t.db.query(
    `UPDATE provider_sessions SET closed_at = now(), close_reason = 'replaced'
     WHERE conversation_id = $1 AND closed_at IS NULL`,
    [chat.conversationId],
  );
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO provider_sessions
       (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash)
     VALUES ($1, $2, $3, 'chat:do', $4, '/tmp', 'h')`,
    [id, chat.conversationId, provider, sessionId],
  );
  return id;
}

async function startTools(scope: Record<string, unknown> = {}): Promise<void> {
  tools = await startSparkTools(t, {
    conversationId: chat.conversationId,
    runId: chat.runId,
    actions: recorded.hooks,
    ...scope,
  });
}

async function edit(args: Record<string, unknown>) {
  const result = await tools.call('spark_rules_edit', args);
  return { ...result, facts: result.isError ? {} : result.json() };
}

async function answer(optionId: string): Promise<Approval> {
  const card = await answerCard(t, optionId);
  return cardResult(t, card.id);
}

const userRules = async () =>
  JSON.parse(await readFile(sparkRulesFiles().user, 'utf8')) as {
    permissions: Record<string, string[]>;
  };

async function grantSession(): Promise<void> {
  const asked = await edit(RELEASE);
  expect(asked.facts.outcome).toBe('waiting_for_user');
  const done = await answer(RULES_SESSION_OPTION);
  expect(done.payload.sparkResult?.state).toBe('done');
}

async function performsAtOnce(args = ISSUES): Promise<Approval> {
  const result = await edit(args);
  expect(result.facts.outcome).toBe('done');
  return (await getApproval(t.db, result.facts.approvalId as string)) ?? (await lastCard());
}

async function lastCard(): Promise<Approval> {
  const { rows } = await t.db.query<{ id: string }>(
    `SELECT id FROM approvals WHERE kind = 'spark_action' ORDER BY created_at DESC LIMIT 1`,
  );
  return (await getApproval(t.db, rows[0]!.id))!;
}

async function asksAgain(): Promise<void> {
  const result = await edit(ISSUES);
  expect(result.facts.outcome).toBe('waiting_for_user');
}

beforeEach(async () => {
  t = await createTestDb();
  recorded = recordedHooks();
  chat = await startChat(t, 'Let gh release create follow my mode');
  await setRun('claude', 'bypassPermissions');
  await openSession();
  await startTools();
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await t.cleanup();
});

describe('spark_rules_edit always asks first', () => {
  it('shows the card in Bypass permissions with three answers and changes nothing yet', async () => {
    const result = await edit(RELEASE);
    expect(result.facts.outcome).toBe('waiting_for_user');
    const card = await pendingCard(t);
    expect(card.title).toBe('Change your Spark rules?');
    expect(card.options.map((option) => option.name)).toEqual([
      'Allow for this session',
      'Allow once',
      'Deny',
    ]);
    expect(card.payload.sparkAction).toMatchObject({
      action: 'rules_edit',
      target: 'user',
      agent: 'Claude',
      add: [{ effect: 'allow', rule: 'Gh(release create)' }],
    });
    expect((await userRules()).permissions.allow).not.toContain('Gh(release create)');
  });

  it('waits for the user to review a change made outside Spark', async () => {
    await edit({ add: [{ effect: 'deny', rule: 'Gh(repo delete)' }] });
    await answer(SPARK_ACTION_OPTION.decline);
    await writeFile(sparkRulesFiles().user, JSON.stringify({ permissions: {}, theme: 'dark' }));
    const result = await edit(RELEASE);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(OUTSIDE_CHANGE_REFUSAL);
  });

  it('refuses rule ids Spark does not know, before any card', async () => {
    const result = await edit({ add: [{ effect: 'allow', rule: 'Bash(npm test)' }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Not Spark rules: Bash(npm test)');
  });

  it('shows one card for the same request asked twice', async () => {
    const first = await edit(RELEASE);
    const second = await edit(RELEASE);
    expect(second.facts.approvalId).toBe(first.facts.approvalId);
    const { rows } = await t.db.query("SELECT 1 FROM approvals WHERE status = 'pending'");
    expect(rows).toHaveLength(1);
  });

  it('says nothing changed when the file already says that', async () => {
    const result = await edit({ add: [{ effect: 'deny', rule: 'Push' }] });
    expect(result.facts.outcome).toBe('unchanged');
  });

  it('refuses a stale card: the file changed after it was shown', async () => {
    await edit(RELEASE);
    await saveSparkRules({ workflows: 'refused' });
    const done = await answer(SPARK_ACTION_OPTION.confirm);
    expect(done.payload.sparkResult).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('changed after the card was shown'),
    });
    expect((await userRules()).permissions.allow).not.toContain('Gh(release create)');
  });
});

describe('Allow for this session', () => {
  it('skips the card for the rest of the session and audits the grant', async () => {
    await grantSession();
    expect((await userRules()).permissions.allow).toContain('Gh(release create)');
    const card = await performsAtOnce();
    expect(card.decidedBy).toBe('level');
    expect((await userRules()).permissions.allow).toContain('Gh(issue create)');
    const audits = recorded.audited as { method: string; params: Record<string, unknown> }[];
    expect(audits.at(-1)).toMatchObject({
      method: 'spark/rules_edit',
      params: { outcome: 'performing', grant: 'session' },
    });
  });

  it('asks again after the agent mode changes', async () => {
    await grantSession();
    await setRun('claude', 'acceptEdits');
    await asksAgain();
  });

  it('asks again after the agent changes', async () => {
    await grantSession();
    await setRun('codex', 'agent-full-access');
    await openSession('codex');
    await asksAgain();
  });

  it('asks again in a new agent session', async () => {
    await grantSession();
    await openSession();
    await asksAgain();
  });

  it('survives a Spark restart when the same session resumes', async () => {
    await grantSession();
    await tools.close();
    await startTools();
    await performsAtOnce();
  });

  it('is not given by Allow once', async () => {
    await edit(RELEASE);
    await answer(SPARK_ACTION_OPTION.confirm);
    await asksAgain();
  });

  it('never applies to a turn the user did not type', async () => {
    await grantSession();
    await setRun('claude', 'bypassPermissions', 'outpost');
    await asksAgain();
  });

  it('covers only the file it was given for', async () => {
    await grantSession();
    const result = await edit({ target: 'managed', ...ISSUES });
    expect(result.facts.outcome).toBe('waiting_for_user');
    expect((await pendingCard(t)).title).toBe('Change your company’s rules?');
  });
});

describe('the company file', () => {
  it('is written only after the card, at its own path', async () => {
    await edit({ target: 'managed', add: [{ effect: 'deny', rule: 'Gh(repo delete)' }] });
    const done = await answer(SPARK_ACTION_OPTION.confirm);
    expect(done.payload.sparkResult?.message).toBe(
      'Changed managed-settings.json: + deny Gh(repo delete).',
    );
    const managed = JSON.parse(await readFile(sparkRulesFiles().managed, 'utf8'));
    expect(managed.permissions.deny).toEqual(['Gh(repo delete)']);
  });
});

describe('where it is never offered or answered', () => {
  it('refuses a turn started on a paired device', async () => {
    await t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [
      chat.runId,
      randomUUID(),
    ]);
    const result = await edit(RELEASE);
    expect(result.text).toContain(RULES_RUN_REFUSALS.remote);
  });

  it('refuses a spoken message', async () => {
    await setRun('claude', 'bypassPermissions', 'voice');
    expect((await edit(RELEASE)).text).toContain(RULES_RUN_REFUSALS.voice);
  });

  it('is not offered to Ask Spark', async () => {
    await tools.close();
    await startTools({ assistant: true });
    const result = await edit(RELEASE);
    expect(result.isError).toBe(true);
  });
});
