import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { Approval } from '@spark-outpost/contracts';
import { chatAgentTerminals } from '../src/persistence/agent-terminals.ts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import type { AuditMarks } from '../src/providers/provider.ts';
import type { SparkScope } from '../src/spark-mcp/deps.ts';
import { callSparkTool } from '../src/spark-mcp/server.ts';
import { terminalRunTool } from '../src/spark-mcp/tools/terminal-run-tool.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import type { SparkCommandScope } from '../src/workflow/command-gate.ts';
import { TERMINAL_STOP_AUDIT } from '../src/workflow/terminal-audit.ts';
import { doRun, recordingAppend, type LinkedRun } from './approval-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

export interface Audited {
  message: { method: string; params: Record<string, unknown> };
  marks: AuditMarks | undefined;
}

export interface Turn {
  scope: SparkScope;
  events: ReturnType<typeof recordingAppend>['events'];
  audited: Audited[];
  waiters: ApprovalWaiters;
  timedOut: () => number;
  stop(): void;
}

export interface Answer {
  action: string;
  refused?: boolean;
  reason?: string;
  terminal?: { id: string; state: string; stoppedBy: string | null };
  terminals?: { id: string; state: string }[];
}

type ChatRun = Pick<LinkedRun, 'runId' | 'conversationId'>;

export type Bench = Awaited<ReturnType<typeof openBench>>;

export async function openBench() {
  const t: TestDb = await createTestDb();
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-terminal-tool-')));
  await mkdir(path.join(base, 'web'));
  const chat = await doRun(t, base);

  async function turn(
    mode: string,
    change: Partial<SparkCommandScope> = {},
    run: ChatRun = chat,
    timeoutMs = 15_000,
  ): Promise<Turn> {
    await t.db.query('UPDATE runs SET agent_mode = $2 WHERE id = $1', [run.runId, mode]);
    const recorded = recordingAppend();
    const audited: Audited[] = [];
    const controller = new AbortController();
    const waiters = new ApprovalWaiters();
    let timeouts = 0;
    return {
      events: recorded.events,
      audited,
      waiters,
      timedOut: () => timeouts,
      stop: () => controller.abort(),
      scope: {
        workspaceId: t.workspaceId,
        conversationId: run.conversationId,
        runId: run.runId,
        commands: {
          db: t.db,
          runId: run.runId,
          provider: 'claude',
          agentMode: mode,
          runMode: 'do',
          role: null,
          piece: null,
          readOnly: false,
          roots: [{ path: base, ignore: [] }],
          home: homedir(),
          ...change,
        },
        actions: {
          append: recorded.append,
          waiters,
          signal: controller.signal,
          timeoutMs,
          pollMs: 20,
          onTimeout: () => void (timeouts += 1),
          audit: {
            message: (_direction, message, marks) =>
              void audited.push({ message: message as Audited['message'], marks }),
            stderr: () => undefined,
          },
          replySoFar: () => ({ shown: 'Starting the dev server.', held: 2 }),
        },
      },
    };
  }

  async function call(on: Turn, args: Record<string, unknown>, callId?: string) {
    const result = await callSparkTool(terminalRunTool, args, {
      deps: toolDeps(t),
      scope: on.scope,
      ...(callId ? { callId } : {}),
    });
    const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
    const isError = result.isError === true;
    const answer: Answer = isError ? { action: 'error' } : (JSON.parse(texts[0]!) as Answer);
    return { isError, texts, answer };
  }

  const start = (
    on: Turn,
    command = 'pnpm dev',
    extra: Record<string, unknown> = {},
    callId?: string,
  ) => call(on, { action: 'start', command, ...extra }, callId).then((result) => result.answer);

  const rows = (conversationId = chat.conversationId) => chatAgentTerminals(t.db, conversationId);

  async function cards(runId = chat.runId): Promise<Approval[]> {
    const found = await t.db.query<{ id: string }>(
      'SELECT id FROM approvals WHERE run_id = $1 ORDER BY created_at',
      [runId],
    );
    const all = await Promise.all(found.rows.map((row) => getApproval(t.db, row.id)));
    return all.flatMap((card) => card ?? []);
  }

  async function pendingCard(runId = chat.runId): Promise<Approval> {
    const card = await eventually(async () =>
      (await cards(runId)).find((candidate) => candidate.status === 'pending'),
    );
    return card!;
  }

  async function answerCard(on: Turn, optionId: string): Promise<Approval> {
    const card = await pendingCard();
    const decided = await decideApproval(t.db, t.workspaceId, card.id, { optionId, scope: 'once' });
    on.waiters.notify(card.id);
    return decided;
  }

  const names = (on: Turn) =>
    on.events.flatMap(({ event }) => ('name' in event && event.name ? [event.name] : []));

  async function stopEntries(runId: string) {
    const { rows: found } = await t.db.query<{ payload: { params: Record<string, unknown> } }>(
      'SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = $2 ORDER BY seq',
      [runId, TERMINAL_STOP_AUDIT],
    );
    return found.map((row) => row.payload.params);
  }

  async function close(): Promise<void> {
    await rm(base, { recursive: true, force: true });
    await t.cleanup();
  }

  return {
    t,
    base,
    chat,
    turn,
    call,
    start,
    rows,
    cards,
    pendingCard,
    answerCard,
    names,
    stopEntries,
    close,
  };
}
