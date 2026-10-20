import type { ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { agentCounts, type AgentCounts } from '../chat/subagents/agent-cards.ts';
import { hideSecrets } from '../chat/status/status-text.ts';
import { sessionState, type Card } from './island-model.ts';
import { waitingTitle } from './island-rest-line.ts';

export const INBOX_FINISHED = 4;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function shortAgo(iso: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function answerable(card: Card): boolean {
  return !card.loading && card.approval !== null && card.kind === 'approval';
}

export function topAnswerable(cards: readonly Card[]): Card | null {
  return cards.find(answerable) ?? null;
}

export interface RunningRow {
  chat: ConversationSummary;
  detail: string;
  agents: AgentCounts | null;
}

function agentsOf(chat: ConversationSummary, detail: ConversationDetail | undefined) {
  const runId = chat.latestRun?.id;
  const rows = runId ? (detail?.subagents?.[runId] ?? []) : [];
  return rows.length > 0 ? agentCounts(rows) : null;
}

function agentsText(counts: AgentCounts): string {
  const noun = counts.total === 1 ? 'agent' : 'agents';
  if (counts.working === 0) return `${counts.total} ${noun} finished`;
  return `${counts.working} of ${counts.total} ${noun} working`;
}

export function agentsProgress(counts: AgentCounts): number {
  return counts.total === 0 ? 0 : (counts.total - counts.working) / counts.total;
}

export function runningRows(
  chats: readonly ConversationSummary[],
  details: ReadonlyMap<string, ConversationDetail>,
): RunningRow[] {
  return chats
    .filter((chat) => !chat.archivedAt && sessionState(chat) === 'working')
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((chat) => {
      const agents = agentsOf(chat, details.get(chat.id));
      const step = chat.latestRun?.step ? hideSecrets(chat.latestRun.step) : null;
      return { chat, agents, detail: agents ? agentsText(agents) : (step ?? 'working') };
    });
}

export interface FinishedRow {
  kind: 'done' | 'failed';
  chat: ConversationSummary;
  detail: string;
  at: string;
}

function failedUnseen(chat: ConversationSummary): boolean {
  const finishedAt = chat.latestRun?.finishedAt;
  if (!finishedAt) return false;
  return !chat.seenAt || Date.parse(finishedAt) > Date.parse(chat.seenAt);
}

function finishedKind(chat: ConversationSummary): FinishedRow['kind'] | null {
  if (chat.archivedAt || chat.needsInput) return null;
  const status = chat.latestRun?.status;
  if (status === 'failed') return failedUnseen(chat) ? 'failed' : null;
  if (status === 'succeeded') return chat.unread ? 'done' : null;
  return null;
}

function finishedDetail(kind: FinishedRow['kind'], chat: ConversationSummary): string {
  if (kind === 'done') return 'done';
  const error = chat.latestRun?.error ? hideSecrets(chat.latestRun.error) : null;
  return error ? `failed: ${error}` : 'failed';
}

export function finishedRows(
  chats: readonly ConversationSummary[],
  cleared: ReadonlySet<string>,
): FinishedRow[] {
  const rows = chats.flatMap((chat): FinishedRow[] => {
    const kind = finishedKind(chat);
    if (!kind || cleared.has(chat.id)) return [];
    const at = chat.latestRun?.finishedAt ?? chat.updatedAt;
    return [{ kind, chat, detail: finishedDetail(kind, chat), at }];
  });
  return rows.toSorted((a, b) => b.at.localeCompare(a.at)).slice(0, INBOX_FINISHED);
}

export interface CardLine {
  verb: string | null;
  code: string | null;
  text: string | null;
}

function pathsText(paths: readonly string[]): string {
  return paths.length === 1 ? paths[0]! : `${paths.length} files`;
}

export function cardLine(card: Card): CardLine {
  const approval = card.approval;
  if (card.loading || !approval) return { verb: null, code: null, text: waitingTitle(card) };
  if (card.kind === 'force') {
    return { verb: 'Force-push', code: approval.payload.forcePush?.join(', ') ?? null, text: null };
  }
  if (card.kind === 'approval' && approval.payload.command) {
    return { verb: 'Run', code: hideSecrets(approval.payload.command), text: null };
  }
  if (card.kind === 'approval' && approval.payload.paths.length > 0) {
    return { verb: 'Change', code: pathsText(approval.payload.paths), text: null };
  }
  const question = approval.payload.checkpoint?.question?.trim();
  return { verb: null, code: null, text: question || waitingTitle(card) };
}
