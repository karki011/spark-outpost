import { randomUUID } from 'node:crypto';
import type { NativeTerminalProvider, TerminalApproval } from '@spark-outpost/contracts';

export const CLAUDE_PERMISSION_HOOK_SECONDS = 600;
export const CLAUDE_PERMISSION_WAIT_MS = 590_000;
export const CODEX_PERMISSION_WAIT_MS = 2_000;

export type ApprovalAnswer = 'allow' | 'deny';

export interface PendingApproval extends TerminalApproval {
  conversationId: string;
  sessionId: string;
  provider: NativeTerminalProvider;
  via: 'hook' | 'keys';
  settle: (answer: ApprovalAnswer | null) => void;
}

export interface ApprovalRequest {
  conversationId: string;
  sessionId: string;
  provider: NativeTerminalProvider;
  tool: string;
  detail: string;
}

export function terminalApprovals() {
  const pending = new Map<string, PendingApproval>();
  const remove = (conversationId: string, id: string) => {
    if (pending.get(conversationId)?.id === id) pending.delete(conversationId);
  };
  const clear = (conversationId: string) => {
    const current = pending.get(conversationId);
    if (!current) return;
    pending.delete(conversationId);
    current.settle(null);
  };
  const open = (
    request: ApprovalRequest,
    via: PendingApproval['via'],
    settle: PendingApproval['settle'],
  ) => {
    clear(request.conversationId);
    const entry: PendingApproval = {
      ...request,
      id: randomUUID(),
      via,
      denyStopsTurn: request.provider === 'codex',
      settle,
    };
    pending.set(request.conversationId, entry);
    return entry;
  };
  return {
    current: (conversationId: string): PendingApproval | null =>
      pending.get(conversationId) ?? null,
    clear,
    noteKeys(request: ApprovalRequest): PendingApproval {
      return open(request, 'keys', () => undefined);
    },
    wait(
      request: ApprovalRequest,
      { signal, timeoutMs }: { signal: AbortSignal; timeoutMs: number },
    ): Promise<ApprovalAnswer | null> {
      return new Promise((resolve) => {
        let entry: PendingApproval | null = null;
        let done = false;
        const finish = (answer: ApprovalAnswer | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', aborted);
          if (entry) remove(request.conversationId, entry.id);
          resolve(answer);
        };
        const aborted = () => finish(null);
        const timer = setTimeout(() => finish(null), timeoutMs);
        entry = open(request, 'hook', finish);
        if (signal.aborted) finish(null);
        else signal.addEventListener('abort', aborted, { once: true });
      });
    },
    take(conversationId: string, id: string): PendingApproval | null {
      const current = pending.get(conversationId);
      if (current?.id !== id) return null;
      pending.delete(conversationId);
      return current;
    },
  };
}

export type TerminalApprovals = ReturnType<typeof terminalApprovals>;
