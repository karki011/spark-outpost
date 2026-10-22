import type { ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { agentCounts, type AgentCounts } from '../chat/subagents/agent-cards.ts';
import { hideSecrets } from '../chat/status/status-text.ts';
import { sessionState, type Card } from './island-model.ts';
import { waitingTitle } from './island-rest-line.ts';
import { waitingToStart } from '../conversations/waiting-to-start.ts';

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

export function runningRows(
  chats: readonly ConversationSummary[],
  details: ReadonlyMap<string, ConversationDetail>,
): RunningRow[] {
  return chats
    .filter((chat) => !chat.archivedAt && sessionState(chat) === 'working')
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((chat) => {
      const agents = agentsOf(chat, details.get(chat.id));
      const run = chat.latestRun;
      const step =
        run?.status === 'queued'
          ? waitingToStart(run.ahead)
          : run?.step
            ? hideSecrets(run.step)
            : null;
      return { chat, agents, detail: agents ? agentsText(agents) : (step ?? 'working') };
    });
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
