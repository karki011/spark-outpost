import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { GIT_CONTROL_REASON, INSTRUCTION_REASON } from '../src/approvals/decide.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { HOOK_APPEND, ORDINARY_COMMAND, RULES_APPEND } from './fake-acp-floor.ts';
import {
  TRIVIAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CLAUDE_MODES = JSON.stringify([
  ['default', 'Manual', null, 'standard'],
  ['acceptEdits', 'Accept edits', null, 'standard'],
  ['auto', 'Auto', null, 'auto_review'],
  ['bypassPermissions', 'Bypass permissions', null, 'full_access'],
]);
const RULES = '# Rules\n';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  writeFileSync(join(root, 'AGENTS.md'), RULES);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('add', 'AGENTS.md');
  git('commit', '-qm', 'rules');
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

const floorCard = (approval: Approval) =>
  (approval.payload.instructionFiles ?? approval.payload.gitControl) !== undefined;

const denyFloorCards: Answerer = (approval) => {
  if (!floorCard(approval)) return answerEverything(approval);
  const reject = approval.options.find((option) => option.kind === 'reject_once');
  return reject ? { optionId: reject.optionId } : null;
};

async function run(mode: string, tags: string) {
  const scenario = { ...TRIVIAL, text: `${TRIVIAL.text} ${tags}` };
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), {
    sessions: store,
    agentEnv: { FAKE_ACP_MODES: CLAUDE_MODES },
  });
  const sent = await startScenario(t, root, scenario, 'hands-off', 'auto', 'sonnet', mode);
  const { asked } = await driveToEnd(t, sent.conversationId, sent.runId, denyFloorCards);
  await harness.stop();
  harness = null;
  const detail = await getConversationDetail(t.db, sent.conversationId);
  const status = await t.db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
    sent.runId,
  ]);
  const modes = await t.db.query<{ used_mode: string }>(
    `SELECT DISTINCT used_mode FROM runs
     WHERE conversation_id = $1 AND mode = 'do' AND used_mode IS NOT NULL`,
    [sent.conversationId],
  );
  const usedModes = modes.rows.map((row) => row.used_mode);
  return { ...sent, asked, detail: detail!, status: status.rows[0]!.status, usedModes };
}

async function userCards(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ title: string }>(
    `SELECT a.title FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1
       AND (a.status = 'pending' OR a.decided_by NOT IN ('level', 'allowlist', 'run_rule'))
       AND a.kind IN ('edit', 'execute')`,
    [conversationId],
  );
  return rows.map((row) => row.title);
}

async function ranWithoutReview(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ title: string | null }>(
    `SELECT (SELECT s.payload #>> '{params,update,title}' FROM run_protocol_log s
             WHERE s.run_id = l.run_id
               AND s.payload #>> '{params,update,toolCallId}' = l.payload #>> '{params,update,toolCallId}'
               AND s.payload #>> '{params,update,title}' IS NOT NULL
             ORDER BY s.seq LIMIT 1) AS title
     FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE r.conversation_id = $1 AND l.unreviewed`,
    [conversationId],
  );
  return rows.map((row) => row.title ?? '');
}

async function railAudits(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ rail: string }>(
    `SELECT l.payload #>> '{params,rail}' AS rail FROM run_protocol_log l
     JOIN runs r ON r.id = l.run_id
     WHERE r.conversation_id = $1 AND l.method = 'spark/rail_crossed'`,
    [conversationId],
  );
  return rows.map((row) => row.rail).sort();
}

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'the safety floor in %s, where the agent runs most tools without asking',
  { timeout: 120_000 },
  (mode) => {
    it('asks before the agent changes an instruction file', async () => {
      const { asked, detail, usedModes } = await run(mode, '#floorrules');
      expect(usedModes).toEqual([mode]);
      const cards = asked.filter(floorCard);
      expect(cards).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: INSTRUCTION_REASON,
          payload: expect.objectContaining({ instructionFiles: ['AGENTS.md'] }),
        }),
      ]);
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(RULES);
      expect((detail.railFlags ?? []).map((flag) => flag.rail)).toEqual([]);
    });

    it('asks with hold-to-confirm before the agent installs a git hook', async () => {
      const { asked } = await run(mode, '#floorhook');
      const cards = asked.filter(floorCard);
      expect(cards).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: GIT_CONTROL_REASON,
          payload: expect.objectContaining({ gitControl: ['.git/hooks/pre-commit'] }),
        }),
      ]);
      expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false);
    });
  },
);

describe.each(['auto', 'bypassPermissions'])(
  'ordinary work in %s',
  { timeout: 120_000 },
  (mode) => {
    it('raises no card and no flag for an edit, a command and a read', async () => {
      const { conversationId, detail, status, usedModes } = await run(mode, '#floorordinary');
      expect([status, usedModes]).toEqual(['succeeded', [mode]]);
      expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toContain('changed\n');
      expect(await userCards(conversationId)).toEqual([]);
      expect(detail.railFlags ?? []).toEqual([]);
      expect(await ranWithoutReview(conversationId)).toEqual(
        expect.arrayContaining(['Edit notes.txt', ORDINARY_COMMAND]),
      );
    });
  },
);

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'a shell command in %s that changes a protected file without a permission request',
  { timeout: 120_000 },
  (mode) => {
    it('is flagged afterwards with a card, a notice and an audit entry, and the run goes on', async () => {
      const { conversationId, detail, status } = await run(mode, '#floorshell');
      expect(status).toBe('succeeded');
      const flags = detail.railFlags ?? [];
      expect(flags.map((flag) => [flag.rail, flag.paths, flag.status]).sort()).toEqual([
        ['git_control', ['.git/hooks/pre-push'], 'open'],
        ['instructions', ['AGENTS.md'], 'open'],
      ]);
      expect(detail.conversation.attention).toMatchObject({ kind: 'flag' });
      expect(await railAudits(conversationId)).toEqual(['git_control', 'instructions']);
      expect(await userCards(conversationId)).toEqual([]);
      expect(await ranWithoutReview(conversationId)).toEqual(
        expect.arrayContaining([RULES_APPEND, HOOK_APPEND]),
      );
    });
  },
);
