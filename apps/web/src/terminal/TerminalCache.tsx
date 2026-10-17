import { useQuery } from '@tanstack/react-query';
import type {
  ConversationSummary,
  NativeTerminalSession,
  NativeTerminalUsage,
} from '@spark-outpost/contracts';
import { CacheTimer } from '../usage/CacheTimer.tsx';
import { terminalUsageQuery } from './usage/terminal-usage-api.ts';

const LIVE_TURN = new Set(['queued', 'running', 'awaiting_approval']);

export function terminalIdle(
  chat: ConversationSummary,
  native: NativeTerminalSession | null,
  usage: NativeTerminalUsage | undefined,
): boolean {
  if (native?.state !== 'ready' || chat.needsInput) return false;
  if (chat.latestRun && LIVE_TURN.has(chat.latestRun.status)) return false;
  return (usage?.promptCache?.subagentsWorking ?? 0) === 0;
}

export function TerminalCache({
  chat,
  native,
}: {
  chat: ConversationSummary;
  native: NativeTerminalSession | null;
}) {
  const usage = useQuery({ ...terminalUsageQuery(chat.id), enabled: native?.provider === 'claude' });
  const last = usage.data?.promptCache?.last ?? null;
  return <CacheTimer last={last} idle={terminalIdle(chat, native, usage.data)} />;
}
