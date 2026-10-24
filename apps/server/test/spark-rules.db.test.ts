import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveRunTarget } from '../src/api/run-target.ts';
import {
  ApprovalConflictError,
  ApprovalInputError,
  shownApprovalsForConversation,
} from '../src/persistence/approvals.ts';
import { listQueue } from '../src/persistence/chat-queue.ts';
import {
  saveSparkRules,
  seedWorkspaceRules,
  sparkRules,
  sparkRulesForRun,
} from '../src/persistence/spark-rules.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { publishGrant } from '../src/workflow/publish-context.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { answerRuleCard } from '../src/workflow/spark-rule-cards.ts';
import { commandRequest, doRun, recordingAppend, type LinkedRun } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const WORKFLOW = 'gh workflow run cd-alfa.yml';
const RELEASE = 'gh release create v1.2.0 --notes "Release"';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-rules-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function gateFor(runId: string, mode: string) {
  const waiters = new ApprovalWaiters();
  const gate = createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode,
    changesProject: true,
    append: recordingAppend().append,
    waiters,
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    publish: { level: 'hands-off', requested: false },
  });
  return { gate, waiters };
}

const signal = () => new AbortController().signal;
const target = (conversationId: string) =>
  resolveRunTarget(
    { db: t.db, workspaceId: t.workspaceId, fixedRunProvider: 'fake' },
    conversationId,
  );

async function refusedCard(run: LinkedRun, command: string) {
  const { gate } = gateFor(run.runId, 'bypassPermissions');
  const answer = await gate.review(commandRequest(root, command, randomUUID()), signal());
  expect(answer).toMatchObject({ outcome: 'selected', allowed: false });
  const cards = await shownApprovalsForConversation(t.db, run.conversationId);
  const card = cards.find((shown) => shown.payload.command === command);
  return { answer, card: card! };
}

async function finish(runId: string) {
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    runId,
  ]);
}

async function retryRunOf(cardId: string): Promise<string> {
  return eventually(async () => {
    const { rows } = await t.db.query<{ rule_retry_run_id: string | null }>(
      'SELECT rule_retry_run_id FROM approvals WHERE id = $1',
      [cardId],
    );
    return rows[0]?.rule_retry_run_id ?? null;
  });
}

describe('Run a workflow', () => {
  it("follows the agent's mode by default: at once in Bypass permissions", async () => {
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId, 'bypassPermissions');
    const answer = await gate.review(commandRequest(root, WORKFLOW), signal());
    expect(answer).toMatchObject({ allowed: true });
  });

  it('asks with an ordinary card in Manual', async () => {
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId, 'default');
    const stop = new AbortController();
    const waiting = gate.review(commandRequest(root, WORKFLOW), stop.signal);
    const pending = await eventually(async () => {
      const { rows } = await t.db.query<{ id: string; reason: string | null }>(
        `SELECT id, reason FROM approvals WHERE run_id = $1 AND status = 'pending'`,
        [run.runId],
      );
      return rows[0] ?? null;
    });
    expect(pending.reason).toBeNull();
    stop.abort();
    expect(await waiting).toMatchObject({ outcome: 'cancelled' });
  });

  it('is refused with a card naming the rule when set to Refused', async () => {
    await saveSparkRules(t.db, t.workspaceId, { workflows: 'refused' });
    const run = await doRun(t, root);
    const { answer, card } = await refusedCard(run, WORKFLOW);
    expect(answer.outcome === 'selected' && answer.denial).toContain('Spark rules');
    expect(card).toMatchObject({
      status: 'denied',
      decidedBy: 'policy',
      ruleAnswer: null,
      payload: { sparkRule: { group: 'workflows', prefix: 'gh workflow run' } },
    });
  });
});

describe('the refused card', () => {
  it('Allow workflows and retry changes the setting and sends the agent a retry', async () => {
    await saveSparkRules(t.db, t.workspaceId, { workflows: 'refused' });
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, WORKFLOW);
    await finish(run.runId);

    const answered = await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_group', target);
    expect(answered.ruleAnswer).toBe('allow_group');
    expect((await sparkRules(t.db, t.workspaceId)).workflows).toBe('mode');

    const retry = await retryRunOf(card.id);
    const input = await loadRunInput(t.db, retry);
    expect(input.prompt).toContain(WORKFLOW);
    expect(input.sparkRuleRetry).toBe(true);
    expect(publishGrant(input)).toMatchObject({ requested: false });

    const { gate } = gateFor(retry, 'bypassPermissions');
    const again = await gate.review(commandRequest(root, WORKFLOW, randomUUID()), signal());
    expect(again).toMatchObject({ allowed: true });
  });

  it('Allow once lets just that exact command through in the retry turn', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    expect(card.payload.sparkRule).toEqual({ group: 'other', prefix: 'gh release create' });
    await finish(run.runId);

    await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_once', target);
    expect((await sparkRules(t.db, t.workspaceId)).ghAllowed).toEqual([]);
    const retry = await retryRunOf(card.id);
    expect((await sparkRulesForRun(t.db, retry)).once).toEqual([RELEASE]);

    const { gate } = gateFor(retry, 'bypassPermissions');
    const same = await gate.review(commandRequest(root, RELEASE, randomUUID()), signal());
    expect(same).toMatchObject({ allowed: true });
    const other = await gate.review(
      commandRequest(root, 'gh release create v9', randomUUID()),
      signal(),
    );
    expect(other).toMatchObject({ allowed: false });
  });

  it('queues the retry while the turn is still running', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_group', target);
    expect((await sparkRules(t.db, t.workspaceId)).ghAllowed).toEqual(['gh release create']);
    const queue = await listQueue(t.db, run.conversationId);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ sparkRuleCardId: card.id });
  });

  it('Keep refused changes nothing and sends nothing', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    await finish(run.runId);
    await answerRuleCard(t.db, t.workspaceId, card.id, 'keep', target);
    expect(await sparkRules(t.db, t.workspaceId)).toMatchObject({ ghAllowed: [] });
    expect(await listQueue(t.db, run.conversationId)).toEqual([]);
    const { rows } = await t.db.query('SELECT 1 FROM runs WHERE conversation_id = $1', [
      run.conversationId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('does not save a prefix Settings could not hold, and leaves the card open', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, 'gh my_ext run now');
    expect(card.payload.sparkRule).toEqual({ group: 'other', prefix: 'gh my_ext run' });
    await expect(
      answerRuleCard(t.db, t.workspaceId, card.id, 'allow_group', target),
    ).rejects.toBeInstanceOf(ApprovalInputError);
    expect((await sparkRules(t.db, t.workspaceId)).ghAllowed).toEqual([]);
    const again = await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_once', target);
    expect(again.ruleAnswer).toBe('allow_once');
  });

  it('is answered once', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    await answerRuleCard(t.db, t.workspaceId, card.id, 'keep', target);
    await expect(
      answerRuleCard(t.db, t.workspaceId, card.id, 'allow_once', target),
    ).rejects.toBeInstanceOf(ApprovalConflictError);
  });
});

describe("Spark's rules file", () => {
  const userFile = () => process.env.SPARK_RULES_FILE!;
  const fileRules = async () =>
    JSON.parse(await readFile(userFile(), 'utf8')) as { permissions: Record<string, string[]> };

  it('moves the old Settings choices into the file it seeds', async () => {
    await t.db.query(
      `INSERT INTO profiles (workspace_id, gh_workflows, gh_allowed) VALUES ($1, 'refused', $2)
       ON CONFLICT (workspace_id) DO UPDATE
         SET gh_workflows = EXCLUDED.gh_workflows, gh_allowed = EXCLUDED.gh_allowed`,
      [t.workspaceId, ['gh release create']],
    );
    expect(await seedWorkspaceRules(t.db, t.workspaceId)).toBe(true);
    const { permissions } = await fileRules();
    expect(permissions.deny).toEqual(expect.arrayContaining(['Gh(workflow run)', 'Gh(*)']));
    expect(permissions.allow).toEqual(['Gh(release create)']);
    expect(await sparkRules(t.db, t.workspaceId)).toEqual({
      workflows: 'refused',
      ghAllowed: ['gh release create'],
    });
  });

  it('saves Settings changes in the file, not the database', async () => {
    await saveSparkRules(t.db, t.workspaceId, { workflows: 'refused', ghAllowed: ['gh pr ready'] });
    const { permissions } = await fileRules();
    expect(permissions.deny).toContain('Gh(run cancel)');
    expect(permissions.allow).toEqual(['Gh(pr ready)']);
    const { rows } = await t.db.query<{ gh_workflows: string }>(
      'SELECT gh_workflows FROM profiles WHERE workspace_id = $1',
      [t.workspaceId],
    );
    expect(rows[0]?.gh_workflows ?? 'mode').toBe('mode');
  });

  it('hands a rule the user deleted to the agent’s mode in the gate', async () => {
    await seedWorkspaceRules(t.db, t.workspaceId);
    const text = await readFile(userFile(), 'utf8');
    await writeFile(userFile(), text.replace('"Gh(*)"', '"Gh(issue create)"'));
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId, 'bypassPermissions');
    const answer = await gate.review(commandRequest(root, RELEASE), signal());
    expect(answer).toMatchObject({ allowed: true });
  });

  it('reports what it could not use and keeps the recommended rules for a broken file', async () => {
    await seedWorkspaceRules(t.db, t.workspaceId);
    await writeFile(userFile(), '{ "permissions": { "deny": ["Push", "Nope"] }, "theme": 1 }');
    expect((await sparkRules(t.db, t.workspaceId)).problems).toEqual([
      `settings.json: "theme" is kept but Spark doesn't use it`,
      `settings.json: "Nope" in deny isn't a Spark rule, so it is not applied`,
    ]);
    await writeFile(userFile(), '{ nope');
    const run = await doRun(t, root);
    const { answer } = await refusedCard(run, RELEASE);
    expect(answer).toMatchObject({ allowed: false });
  });
});
