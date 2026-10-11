import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_LOG_MAX_LIMIT,
  modeForLegacy,
  type Approval,
  type ApprovalScope,
  type InvolvementLevel,
  type ProtocolLogEntry,
  type Run,
  type RunChanges,
} from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { listProtocolLog } from '../src/persistence/audit-log.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { runChanges } from '../src/projects/run-changes.ts';
import { linkedConversation } from './approval-support.ts';
import { eventually, pinChatLevel, type TestDb } from './support.ts';
import { DEFAULT_MODEL } from './turn-worker.ts';

export async function gitRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-turn-')));
  await writeFile(join(root, 'notes.txt'), 'start\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return root;
}

export const removeRepo = (root: string) => rm(root, { recursive: true, force: true });

export interface ChatOptions {
  root?: string;
  level?: InvolvementLevel;
}

export async function openChat(t: TestDb, { root, level }: ChatOptions = {}): Promise<string> {
  const conversationId = root
    ? (await linkedConversation(t, root)).conversationId
    : (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  if (level) await pinChatLevel(t.db, conversationId, level);
  return conversationId;
}

export interface MessageOptions {
  provider?: string;
  model?: string;
  permission?: 'ask' | 'do';
  agentMode?: string | null;
  level?: InvolvementLevel;
}

function defaultModel(provider: string): string | null {
  return provider === 'claude' || provider === 'codex' ? DEFAULT_MODEL[provider] : null;
}

export async function sendMessage(
  t: TestDb,
  conversationId: string,
  text: string,
  options: MessageOptions = {},
): Promise<string> {
  const { provider = 'claude', permission = 'ask', level = 'hands-off' } = options;
  const agentMode =
    options.agentMode === undefined
      ? modeForLegacy(provider, permission, level)
      : options.agentMode;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    {
      provider,
      model: options.model ?? defaultModel(provider),
      effort: 'medium',
      permission,
      agentMode,
      level,
    },
  );
  return sent.run.id;
}

export type Answerer = (
  approval: Approval,
) => { optionId: string; note?: string; scope?: ApprovalScope } | null;

export const allowOnce: Answerer = (approval) => {
  const allow = approval.options.find((option) => option.kind === 'allow_once');
  return allow ? { optionId: allow.optionId } : null;
};

export const leaveCards: Answerer = () => null;

export async function cardsOf(t: TestDb, conversationId: string): Promise<Approval[]> {
  const detail = await getConversationDetail(t.db, conversationId);
  return detail?.approvals ?? [];
}

export async function driveToEnd(
  t: TestDb,
  conversationId: string,
  runId: string,
  answer: Answerer = allowOnce,
  timeoutMs = 60_000,
): Promise<{ run: Run; asked: Approval[] }> {
  const asked: Approval[] = [];
  const run = await eventually(async () => {
    for (const approval of await cardsOf(t, conversationId)) {
      if (approval.status !== 'pending') continue;
      if (asked.some((seen) => seen.id === approval.id)) continue;
      const decision = answer(approval);
      if (!decision) continue;
      asked.push(approval);
      await decideApproval(t.db, t.workspaceId, approval.id, { scope: 'once', ...decision });
    }
    const current = await getRun(t.db, runId);
    return current?.finishedAt ? current : null;
  }, timeoutMs);
  return { run, asked };
}

export async function repliesOf(t: TestDb, runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant' ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => row.content);
}

export function changesOf(t: TestDb, runId: string): Promise<RunChanges> {
  return runChanges(t.db, t.workspaceId, runId);
}

export async function auditOf(t: TestDb, runId: string): Promise<ProtocolLogEntry[]> {
  const entries: ProtocolLogEntry[] = [];
  let after: number | null = 0;
  while (after !== null) {
    const page = await listProtocolLog(t.db, runId, { after, limit: AUDIT_LOG_MAX_LIMIT });
    entries.push(...page.entries);
    after = page.nextAfter;
  }
  return entries;
}
