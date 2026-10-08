export type SessionView = 'draft' | 'terminal' | 'chat';

interface SessionFacts {
  conversation: {
    sessionType?: 'chat' | 'terminal' | undefined;
    terminal?: object | null | undefined;
  };
  messages: readonly unknown[];
  runs: readonly unknown[];
}

export function sessionView(
  detail: SessionFacts | undefined,
  launching: boolean,
): SessionView | null {
  if (!detail) return null;
  if (launching) return 'draft';
  const empty = detail.messages.length === 0;
  if (detail.conversation.sessionType === 'terminal')
    return empty && !detail.conversation.terminal ? 'draft' : 'terminal';
  return empty && detail.runs.length === 0 ? 'draft' : 'chat';
}
