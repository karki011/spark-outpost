import { randomUUID } from 'node:crypto';
import type { NativeTerminalProvider, TerminalApprovalDecision } from '@spark-outpost/contracts';

export const CLAUDE_PERMISSION_HOOK_SECONDS = 600;
export const CLAUDE_PERMISSION_WAIT_MS = 590_000;

export type ApprovalAnswer = TerminalApprovalDecision['decision'];

export interface ApprovalRequest {
  conversationId: string;
  provider: NativeTerminalProvider;
  tool: string;
  detail: string;
}

export interface PendingApproval extends ApprovalRequest {
  id: string;
  settle: (answer: ApprovalAnswer | null) => void;
}

export function terminalApprovals() {
  const pending = new Map<string, PendingApproval>();
  const take = (conversationId: string, id: string): PendingApproval | null => {
    const current = pending.get(conversationId);
    if (current?.id !== id) return null;
    pending.delete(conversationId);
    return current;
  };
  const clear = (conversationId: string) => {
    const current = pending.get(conversationId);
    if (current) take(conversationId, current.id)?.settle(null);
  };
  const open = (request: ApprovalRequest, settle: PendingApproval['settle']) => {
    clear(request.conversationId);
    const entry: PendingApproval = { ...request, id: randomUUID(), settle };
    pending.set(request.conversationId, entry);
    return entry;
  };
  return {
    current: (conversationId: string): PendingApproval | null =>
      pending.get(conversationId) ?? null,
    clear,
    take,
    note(request: ApprovalRequest): PendingApproval {
      return open(request, () => undefined);
    },
    wait(
      request: ApprovalRequest,
      { signal, timeoutMs }: { signal: AbortSignal; timeoutMs: number },
    ): Promise<ApprovalAnswer | null> {
      return new Promise((resolve) => {
        const finish = (answer: ApprovalAnswer | null) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', aborted);
          take(request.conversationId, entry.id);
          resolve(answer);
        };
        const aborted = () => finish(null);
        const timer = setTimeout(aborted, timeoutMs);
        const entry = open(request, finish);
        if (signal.aborted) aborted();
        else signal.addEventListener('abort', aborted, { once: true });
      });
    },
  };
}

export type TerminalApprovals = ReturnType<typeof terminalApprovals>;
