import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../../agent-config/records.ts';
import { parseLine } from '../native-transcript.ts';
import { expirePendingApprovals } from '../../persistence/approvals.ts';
import type { Db } from '../../persistence/db.ts';
import type { NativeTerminalRow } from '../../persistence/native-terminals.ts';
import { setNativeTerminalState } from '../../persistence/native-terminal-turns.ts';
import type { SparkScope } from '../../spark-mcp/deps.ts';
import type { SparkMcpHost } from '../../spark-mcp/host.ts';
import type { ApprovalWaiters } from '../../workflow/approval-waiters.ts';
import { loadRunInput } from '../../workflow/run-input.ts';
import { nativeTurnContext } from '../native-context.ts';
import { hookTokenDigest } from '../native-observe.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import type { AgentRequest, TerminalSessions } from '../sessions.ts';
import { shellFolder } from '../shell-folder.ts';
import { readStoredLaunch, sessionRoot, writeObserver } from './adopt-record.ts';
import type { TmuxHost } from './tmux-host.ts';
import { killSessionTree, killUnknownSessions, listSessionIds } from './tmux-session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WAITING = 'Waiting for native lifecycle events.';

export interface ReadoptInput {
  tmux: TmuxHost;
  db: Db;
  workspaceId: string;
  dataDir: string;
  channel: string;
  mcp: SparkMcpHost;
  terminals: TerminalSessions;
  waiters: ApprovalWaiters;
  hookUrl: string;
  permissionUrl?: string;
  live: Map<string, LiveSession>;
  tokens: Map<string, LiveSession>;
  now(): Date;
  syncScope(session: LiveSession): void;
  resumeUsage(session: LiveSession): boolean;
  onExit(session: LiveSession): NonNullable<AgentRequest['onExit']>;
}

async function liveRow(db: Db, workspaceId: string, id: string): Promise<NativeTerminalRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await db.query<NativeTerminalRow>(
    `SELECT n.* FROM native_terminal_sessions n JOIN conversations c ON c.id = n.conversation_id
     WHERE n.id = $1 AND c.workspace_id = $2 AND n.state NOT IN ('exited', 'error', 'interrupted')`,
    [id, workspaceId],
  );
  return rows[0] ?? null;
}

async function openRunInput(db: Db, runId: string | null) {
  if (!runId) return null;
  const { rows } = await db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
    runId,
  ]);
  const status = rows[0]?.status;
  if (status !== 'running' && status !== 'awaiting_approval') return null;
  if (status === 'awaiting_approval') {
    await expirePendingApprovals(db, runId, 'recovery');
    await db.query(`UPDATE runs SET status = 'running' WHERE id = $1 AND status = $2`, [
      runId,
      status,
    ]);
  }
  return loadRunInput(db, runId);
}

async function askedBefore(directory: string): Promise<boolean> {
  const observer = await readFile(join(directory, 'observer.json'), 'utf8').then(
    (text) => parseLine(text),
    () => null,
  );
  return isRecord(observer) && typeof observer.permissionUrl === 'string';
}

async function readoptOne(input: ReadoptInput, row: NativeTerminalRow): Promise<void> {
  const { db } = input;
  const root = sessionRoot(input.dataDir, input.channel, row.id);
  const stored = await readStoredLaunch(root);
  const hookToken = randomBytes(32).toString('base64url');
  const observed = stored?.observed === true && row.observation === 'hooks';
  const approvals =
    stored !== null &&
    observed &&
    input.permissionUrl !== undefined &&
    (await askedBefore(stored.directory));
  if (stored && observed)
    await writeObserver(stored.directory, {
      url: input.hookUrl,
      token: hookToken,
      sessionId: row.id,
      provider: row.provider,
      ...(approvals ? { permissionUrl: input.permissionUrl } : {}),
    });
  const scope: SparkScope = {
    workspaceId: input.workspaceId,
    conversationId: row.conversation_id,
    runId: row.active_run_id,
    readOnly: true,
  };
  const located = await shellFolder(db, input.workspaceId, row.conversation_id);
  const folder =
    located.cwd === row.cwd
      ? located
      : { cwd: row.cwd, label: row.label, kind: 'worktree' as const, note: null };
  const turnInput = await openRunInput(db, row.active_run_id);
  const toolsReachable = stored !== null && stored.record.mcpPort === input.mcp.port;
  const grant = toolsReachable
    ? await input.mcp.restore(scope, stored.record.grant)
    : await input.mcp.grant(scope);
  const session: LiveSession = {
    row,
    folder,
    scope,
    grant,
    launch: {
      command: row.provider,
      args: [],
      env: {},
      observation: observed ? 'hooks' : 'unsupported',
      version: '',
      ...(stored ? { directory: stored.directory } : {}),
      dispose: () => rm(root, { recursive: true, force: true }),
    },
    context: turnInput ? await nativeTurnContext(db, row, turnInput, null, input.waiters) : null,
    mode: null,
    ceiling: stored?.record.ceiling ?? (row.provider === 'claude' ? 'auto' : 'agent'),
    seedPending: false,
    nativeSessionEnded: false,
    observedTurnId: row.native_turn_id,
    chain: Promise.resolve(),
    hookKey: hookTokenDigest(hookToken),
    completedTurns: new Set(),
    currentPromptEventId: null,
    completedEvents: new Map(),
    transcript: null,
    readopted: { at: input.now().toISOString(), stepsComplete: false },
  };
  scope.beforeToolCall = async () => {
    await session.chain;
    input.syncScope(session);
  };
  input.live.set(row.conversation_id, session);
  if (observed) input.tokens.set(session.hookKey, session);
  try {
    input.terminals.createAgent({
      id: row.id,
      conversationId: row.conversation_id,
      cwd: row.cwd,
      label: row.label,
      command: row.provider,
      args: [],
      adopt: true,
      onExit: input.onExit(session),
    });
    const idle = turnInput === null && row.state === 'ready';
    if (!idle && (await setNativeTerminalState(db, { ...row, state: 'unknown', reason: WAITING })))
      row.state = 'unknown';
    session.readopted!.stepsComplete = turnInput === null || input.resumeUsage(session);
  } catch (error) {
    input.live.delete(row.conversation_id);
    input.tokens.delete(session.hookKey);
    grant.revoke();
    await session.context?.close();
    throw error;
  }
}

export async function readoptTmuxSessions(input: ReadoptInput): Promise<string[]> {
  const kept: string[] = [];
  killUnknownSessions(input.tmux);
  for (const id of new Set(listSessionIds(input.tmux))) {
    const row = await liveRow(input.db, input.workspaceId, id);
    if (!row) {
      killSessionTree(input.tmux, id);
      continue;
    }
    if (input.live.has(row.conversation_id)) continue;
    try {
      await readoptOne(input, row);
      kept.push(id);
    } catch (error) {
      console.error('Could not re-adopt a terminal session:', (error as Error).message);
      input.terminals.kill(id);
      killSessionTree(input.tmux, id);
    }
  }
  return kept;
}
