import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { APPROVAL_REQUESTED, EventType, type AgentModeOption } from '@spark-outpost/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reviewPermission } from '../src/agents/acp/do-handlers.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { taskOverviews } from '../src/persistence/task-views.ts';
import { createProject } from '../src/projects/projects.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { recordingAppend } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const MODES: AgentModeOption[] = [
  { id: 'default', label: 'Manual', description: null, kind: 'standard' },
  { id: 'plan', label: 'Plan', description: null, kind: 'plan' },
  { id: 'auto', label: 'Auto', description: null, kind: 'auto_review' },
  { id: 'bypassPermissions', label: 'Bypass permissions', description: null, kind: 'full_access' },
];

const OPTIONS: acp.PermissionOption[] = [
  { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
  { optionId: 'reject', name: 'No', kind: 'reject_once' },
];

let t: TestDb;
let base: string;
let web: string;
let dashboards: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-plan-phase-gate-')));
  web = join(base, 'feature-web');
  dashboards = join(base, 'feature-dashboards');
  await mkdir(join(web, 'libs'), { recursive: true });
  await mkdir(join(dashboards, 'docs'), { recursive: true });
  await writeFile(join(web, 'libs', 'query.ts'), 'export const useAnalyticsQuery = 1;\n');
  await writeFile(join(dashboards, 'README.md'), '# Dashboards\n');
  await writeFile(join(dashboards, 'docs', 'arch.md'), '# Architecture\n');
  await writeFile(join(dashboards, '.env'), 'TOKEN=abcdef0123456789\n');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function chatWithTwoRepos(chosenMode: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const first = await createProject(t.db, t.workspaceId, web);
  const second = await createProject(t.db, t.workspaceId, dashboards);
  await setConversationProjects(t.db, t.workspaceId, conversation.id, [
    first.project.id,
    second.project.id,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: '/plan the capitalization report' },
    { provider: 'fake', permission: 'do', agentMode: chosenMode, level: 'full-auto' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

function commandAsked(command: string): acp.RequestPermissionRequest {
  return {
    sessionId: 's1',
    toolCall: { toolCallId: randomUUID(), title: command, kind: 'execute', rawInput: { command } },
    options: OPTIONS,
  };
}

async function planPhase(chosenMode: string) {
  const chat = await chatWithTwoRepos(chosenMode);
  const recorder = recordingAppend();
  const notes: string[] = [];
  const gate = createApprovalGate({
    db: t.db,
    runId: chat.runId,
    provider: 'claude',
    mode: chosenMode,
    modes: MODES,
    changesProject: true,
    append: recorder.append,
    waiters: new ApprovalWaiters(),
    pollMs: 20,
    timeoutMs: 400,
    onTimeout: () => undefined,
    backup: async () => undefined,
  });
  const ask = (command: string, liveMode = 'plan') =>
    reviewPermission(commandAsked(command), 7, {
      policy: {
        roots: [
          { path: web, ignore: [] },
          { path: dashboards, ignore: [] },
        ],
        realpath,
      },
      cwd: web,
      gate,
      signal: new AbortController().signal,
      report: () => undefined,
      annotate: (note) => notes.push(note),
      mode: () => liveMode,
    });
  const records = async () => {
    const { rows } = await t.db.query<{ status: string; decided_by: string | null }>(
      'SELECT status, decided_by FROM approvals WHERE run_id = $1 ORDER BY created_at',
      [chat.runId],
    );
    return rows.map((row) => [row.status, row.decided_by]);
  };
  const cards = () =>
    recorder.events.filter(
      ({ event }) => event.type === EventType.CUSTOM && event.name === APPROVAL_REQUESTED,
    ).length;
  const decisionRows = async () =>
    (await taskOverviews(t.db, chat.conversationId))
      .flatMap((task) => task.items)
      .filter((item) => item.id.startsWith('waiting:'));
  return { ask, records, cards, notes, decisionRows };
}

const SECOND_REPO_LOOP = () =>
  `cd ${dashboards} && sed -n 80,200p README.md; for f in docs/*.md; do echo "== $f"; sed -n 1,20p "$f"; done`;
const RECURSIVE_SEARCH = `grep -rn -E "useAnalyticsQuery|useAnalyticsCatalog" libs --include='*.ts' | head -40`;

describe('commands Claude asks for while it plans in a chat set to Bypass permissions', () => {
  it('runs a read in the second linked repo at once, with no card and no Tasks row', async () => {
    const turn = await planPhase('bypassPermissions');
    const answers = [await turn.ask(SECOND_REPO_LOOP()), await turn.ask(RECURSIVE_SEARCH)];
    expect(answers).toEqual([
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } },
    ]);
    expect(turn.cards()).toBe(0);
    expect(await turn.records()).toEqual([
      ['allowed', 'level'],
      ['allowed', 'level'],
    ]);
    expect(await turn.decisionRows()).toEqual([]);
    expect(turn.notes).toEqual([
      expect.stringMatching(/^Allowed .+ \(Bypass permissions mode\)$/),
      expect.stringMatching(/^Allowed .+ \(Bypass permissions mode\)$/),
    ]);
  });

  it('does the same in a chat set to Auto', async () => {
    const turn = await planPhase('auto');
    await turn.ask(RECURSIVE_SEARCH);
    expect(turn.cards()).toBe(0);
    expect(await turn.records()).toEqual([['allowed', 'level']]);
  });

  it.each([
    ['a file change', 'touch notes.txt'],
    ['a write through a redirect', 'ls > listing.txt'],
    ['a package install', 'pnpm install'],
    ['a command Spark cannot read', 'f() { ls; }; f'],
  ])('still asks before %s', async (_name, command) => {
    const turn = await planPhase('bypassPermissions');
    await turn.ask(command);
    expect(turn.cards()).toBe(1);
    expect(await turn.records()).toEqual([['expired', 'timeout']]);
  });

  it('still asks before a secret file is changed, with the secret reason', async () => {
    const turn = await planPhase('bypassPermissions');
    await turn.ask(`cd ${dashboards} && sed -i '' 's/a/b/' .env`);
    expect(turn.cards()).toBe(1);
    expect(await turn.records()).toEqual([['expired', 'timeout']]);
    const { rows } = await t.db.query<{ reason: string }>('SELECT reason FROM approvals');
    expect(rows[0]!.reason).toMatch(/secret file/);
  });

  it('still refuses a force push', async () => {
    const turn = await planPhase('bypassPermissions');
    await turn.ask('git push --force origin main');
    expect(turn.cards()).toBe(0);
    expect(await turn.records()).toEqual([['denied', 'policy']]);
  });

  it('keeps asking in a chat set to Manual or Plan', async () => {
    for (const chosen of ['default', 'plan']) {
      const turn = await planPhase(chosen);
      await turn.ask(RECURSIVE_SEARCH);
      expect(turn.cards()).toBe(1);
    }
  });

  it('leaves a request made outside the plan phase to the mode it arrives in', async () => {
    const turn = await planPhase('bypassPermissions');
    await turn.ask('touch notes.txt', 'bypassPermissions');
    await turn.ask(RECURSIVE_SEARCH, 'default');
    expect(turn.cards()).toBe(1);
    expect(await turn.records()).toEqual([
      ['allowed', 'level'],
      ['expired', 'timeout'],
    ]);
  });
});
