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
  useRecommendedRules,
  answerOutsideChange,
  setGhAllowed,
  setSparkRule,
  sparkRules,
  sparkRulesForRun,
} from '../src/persistence/spark-rules.ts';
import { rulesTextHash } from '../src/spark-rules/accepted.ts';
import { acceptRulesBaseline } from '../src/spark-rules/rules-store.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { publishGrant } from '../src/workflow/publish-context.ts';
import { sendNow } from '../src/workflow/queue-drain.ts';
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
const allowed = async () => (await sparkRules()).ghAllowed.map((entry) => entry.prefix);
const workflows = async () => (await sparkRules()).rows.find((row) => row.row === 'workflows');
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
    await setSparkRule('workflows', 'deny');
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
    await setSparkRule('workflows', 'deny');
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, WORKFLOW);
    await finish(run.runId);

    const answered = await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_group', target);
    expect(answered.ruleAnswer).toBe('allow_group');
    expect(await workflows()).toMatchObject({ choice: 'allow', source: 'user' });

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
    expect(await allowed()).toEqual([]);
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
    expect(await allowed()).toEqual(['gh release create']);
    const queue = await listQueue(t.db, run.conversationId);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ sparkRuleCardId: card.id });
  });

  it('keeps a queued retry its own: Send now waits until the turn ends', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    await answerRuleCard(t.db, t.workspaceId, card.id, 'allow_once', target);
    const [retry] = await listQueue(t.db, run.conversationId);
    const steer = sendNow(t.db, run.conversationId, { id: retry!.id }, target);
    await expect(steer).rejects.toMatchObject({
      status: 409,
      message: 'A retry from a Spark rules card starts when this chat is free.',
    });
    expect(await listQueue(t.db, run.conversationId)).toHaveLength(1);
    const steered = await t.db.query('SELECT 1 FROM member_messages WHERE id = $1', [retry!.id]);
    expect(steered.rowCount).toBe(0);

    await finish(run.runId);
    expect(await sendNow(t.db, run.conversationId, { id: retry!.id }, target)).toBe('sent');
    const retryRun = await retryRunOf(card.id);
    const { rows } = await t.db.query<{ source: string }>('SELECT source FROM runs WHERE id = $1', [
      retryRun,
    ]);
    expect(rows[0]?.source).toBe('spark_rule');
    expect((await sparkRulesForRun(t.db, retryRun)).once).toEqual([RELEASE]);
  });

  it('Keep refused changes nothing and sends nothing', async () => {
    const run = await doRun(t, root);
    const { card } = await refusedCard(run, RELEASE);
    await finish(run.runId);
    await answerRuleCard(t.db, t.workspaceId, card.id, 'keep', target);
    expect(await allowed()).toEqual([]);
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
    expect(await allowed()).toEqual([]);
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

  it('with no file, leaves every gh command to the mode and shows every rule unset', async () => {
    await rm(userFile());
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId, 'bypassPermissions');
    expect(await gate.review(commandRequest(root, RELEASE), signal())).toMatchObject({
      allowed: true,
    });
    const view = await sparkRules();
    expect(view.ghAllowed).toEqual([]);
    expect(view.rows.every((row) => row.choice === 'mode' && row.source === null)).toBe(true);
  });

  it('Use recommended rules fills an empty file, merge and gh auth rules included', async () => {
    await rm(userFile());
    await useRecommendedRules();
    const { permissions } = await fileRules();
    expect(permissions.deny).toEqual(
      expect.arrayContaining(['Gh(pr merge)', 'Gh(pr review)', 'GhAdmin', 'Gh(auth)', 'Gh(*)']),
    );
    expect(permissions.ask).toContain('Push(force)');
  });

  it('shows the workflow row as mixed when a hand-edited file mixes its commands', async () => {
    await writeFile(userFile(), JSON.stringify({ permissions: { deny: ['Gh(workflow run)'] } }));
    expect(await workflows()).toMatchObject({
      ids: ['Gh(workflow run)', 'Gh(run rerun)', 'Gh(run cancel)'],
      choice: null,
      source: 'user',
    });
  });

  it('takes an allowed command out of ask too, so it really follows the mode', async () => {
    const text = JSON.stringify({
      permissions: { ask: ['Gh(release create)', 'Gh(workflow run)'] },
    });
    await writeFile(userFile(), text);
    await answerOutsideChange({ keep: 'file', fileHash: rulesTextHash({ kind: 'text', text }) });
    await setGhAllowed('gh release create', true);
    await setSparkRule('workflows', 'allow');
    const { permissions } = await fileRules();
    expect(permissions.ask).toEqual([]);
    expect(permissions.allow).toEqual(
      expect.arrayContaining(['Gh(release create)', 'Gh(workflow run)']),
    );
  });

  it('saves Settings changes in the file, not the database', async () => {
    await setSparkRule('workflows', 'deny');
    await setGhAllowed('gh pr ready', true);
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
    const text = await readFile(userFile(), 'utf8');
    await writeFile(userFile(), text.replace('"Gh(*)"', '"Gh(issue create)"'));
    const run = await doRun(t, root);
    const { gate } = gateFor(run.runId, 'bypassPermissions');
    const answer = await gate.review(commandRequest(root, RELEASE), signal());
    expect(answer).toMatchObject({ allowed: true });
  });

  it('reports what it could not use and keeps the recommended rules for a broken file', async () => {
    await writeFile(userFile(), '{ "permissions": { "deny": ["Push", "Nope"] }, "theme": 1 }');
    const view = await sparkRules();
    expect(view.problems).toEqual([]);
    expect(view.unused).toEqual([
      { entry: '"theme": 1', kind: 'key' },
      { entry: '"Nope"', kind: 'rule' },
    ]);
    expect(view.malformed).toBe(false);
    await writeFile(userFile(), '{ nope');
    expect(await sparkRules()).toMatchObject({ malformed: true });
    await expect(setSparkRule('Push', 'ask')).rejects.toThrow('changed outside Spark');
    const run = await doRun(t, root);
    const { answer } = await refusedCard(run, RELEASE);
    expect(answer).toMatchObject({ allowed: false });
  });

  it('keeps the accepted rules in the gate until the user reviews a change made outside Spark', async () => {
    await acceptRulesBaseline();
    const text = await readFile(userFile(), 'utf8');
    await writeFile(userFile(), text.replace('"Gh(*)"', '"Gh(issue create)"'));
    const view = await sparkRules();
    expect(view.outsideChange).toMatchObject({
      added: [{ effect: 'deny', rule: 'Gh(issue create)' }],
      removed: [{ effect: 'deny', rule: 'Gh(*)' }],
    });
    const run = await doRun(t, root);
    const { answer } = await refusedCard(run, RELEASE);
    expect(answer).toMatchObject({ allowed: false });
    const kept = await answerOutsideChange({
      keep: 'spark',
      fileHash: view.outsideChange!.fileHash,
    });
    expect(kept.outsideChange).toBeUndefined();
    expect(await readFile(userFile(), 'utf8')).toBe(text);
  });

  it('sees a rules file created outside Spark when there was none', async () => {
    await rm(userFile());
    await acceptRulesBaseline();
    await writeFile(userFile(), JSON.stringify({ permissions: { allow: ['Gh(*)'] } }));
    const view = await sparkRules();
    expect(view.outsideChange?.added).toEqual([{ effect: 'allow', rule: 'Gh(*)' }]);
    const kept = await answerOutsideChange({
      keep: 'file',
      fileHash: view.outsideChange!.fileHash,
    });
    expect(kept.outsideChange).toBeUndefined();
  });
});
