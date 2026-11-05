import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';

export interface Turn {
  run: Run;
  userMessage: Message | null;
  assistantMessage: Message | null;
  laterMessages: readonly Message[];
}

const NO_MESSAGES: readonly Message[] = [];

function repliesByRun(messages: readonly Message[]): Map<string, Message[]> {
  const byRun = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.runId) continue;
    const replies = byRun.get(message.runId);
    if (replies) replies.push(message);
    else byRun.set(message.runId, [message]);
  }
  return byRun;
}

export function buildTurns(detail: Pick<ConversationDetail, 'messages' | 'runs'>): Turn[] {
  const byId = new Map(detail.messages.map((message) => [message.id, message]));
  const byRun = repliesByRun(detail.messages);
  return topLevelRuns(detail).map((run) => {
    const [reply = null, ...later] = byRun.get(run.id) ?? [];
    return {
      run,
      userMessage: run.userMessageId ? (byId.get(run.userMessageId) ?? null) : null,
      assistantMessage: reply,
      laterMessages: later.length > 0 ? later : NO_MESSAGES,
    };
  });
}

export function latestReplyId(
  detail: Pick<ConversationDetail, 'messages' | 'runs'>,
): string | null {
  const replied = buildTurns(detail).findLast((turn) => turn.assistantMessage !== null);
  return replied?.assistantMessage?.id ?? null;
}

export function topLevelRuns(detail: Pick<ConversationDetail, 'runs'>): Run[] {
  return detail.runs.filter((run) => !run.parentRunId);
}

function isActive(run: Run | undefined): run is Run {
  return (
    run?.status === 'queued' || run?.status === 'running' || run?.status === 'awaiting_approval'
  );
}

export function activeRun(detail: ConversationDetail | undefined): Run | null {
  const latest = detail ? topLevelRuns(detail).at(-1) : undefined;
  return isActive(latest) ? latest : null;
}

export function activeRuns(detail: ConversationDetail | undefined): Run[] {
  return detail ? topLevelRuns(detail).filter(isActive) : [];
}

export function runSeconds(run: Run): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 1000)) : null;
}
