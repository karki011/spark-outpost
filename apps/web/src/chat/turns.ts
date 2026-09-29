import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';

export interface Turn {
  run: Run;
  userMessage: Message | null;
  assistantMessage: Message | null;
}

export function buildTurns(detail: ConversationDetail): Turn[] {
  const byId = new Map(detail.messages.map((message) => [message.id, message]));
  const byRun = new Map(
    detail.messages
      .filter((message) => message.role === 'assistant' && message.runId)
      .map((message) => [message.runId, message]),
  );
  return topLevelRuns(detail).map((run) => ({
    run,
    userMessage: byId.get(run.userMessageId) ?? null,
    assistantMessage: byRun.get(run.id) ?? null,
  }));
}

export function topLevelRuns(detail: ConversationDetail): Run[] {
  return detail.runs.filter((run) => !run.parentRunId);
}

export function activeRun(detail: ConversationDetail | undefined): Run | null {
  const latest = detail ? topLevelRuns(detail).at(-1) : undefined;
  const active =
    latest?.status === 'queued' ||
    latest?.status === 'running' ||
    latest?.status === 'awaiting_approval';
  return active ? latest : null;
}

export function runSeconds(run: Run): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 1000)) : null;
}
