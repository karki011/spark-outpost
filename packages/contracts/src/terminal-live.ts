import { z } from 'zod';
import { nativeTerminalUsageSchema } from './native-terminal-usage.ts';
import { nativeTerminalSessionSchema } from './native-terminal.ts';

export const TERMINAL_LIVE_MAX_CHATS = 64;

export const terminalLiveSchema = z.record(
  z.string(),
  z.object({
    session: nativeTerminalSessionSchema.nullable().optional(),
    usage: nativeTerminalUsageSchema.optional(),
  }),
);
export type TerminalLive = z.infer<typeof terminalLiveSchema>;

const chatsSchema = z.array(z.uuid()).min(1).max(TERMINAL_LIVE_MAX_CHATS);

export function parseTerminalLiveChats(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const parsed = chatsSchema.safeParse(raw.split(','));
  return parsed.success ? [...new Set(parsed.data)] : null;
}
