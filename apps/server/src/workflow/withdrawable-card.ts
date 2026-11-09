import { homedir } from 'node:os';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { settlePending, type NewApproval } from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import type { GateAnswer } from '../providers/provider.ts';
import type { ApprovalGate } from './approval-gate.ts';

function cardRequest(card: NewApproval): ApprovalRequest {
  return {
    toolCallId: card.toolCallId,
    rpcId: card.rpcId,
    kind: card.kind,
    toolKind: null,
    title: card.title,
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    options: card.options,
    roots: [],
    home: homedir(),
  };
}

export async function raiseWithdrawable(
  db: Db,
  gate: ApprovalGate,
  card: NewApproval,
  signal: AbortSignal,
  agentCancel: AbortSignal,
  asked: (approvalId: string) => void = () => undefined,
): Promise<GateAnswer> {
  let pendingId: string | null = null;
  const withdraw = () => {
    if (!pendingId) return;
    void settlePending(db, pendingId, {
      status: 'cancelled',
      decidedBy: 'policy',
      optionId: null,
    }).catch(() => undefined);
  };
  agentCancel.addEventListener('abort', withdraw, { once: true });
  try {
    return await gate.raise(card, cardRequest(card), signal, (id) => {
      pendingId = id;
      asked(id);
      if (agentCancel.aborted) withdraw();
    });
  } finally {
    agentCancel.removeEventListener('abort', withdraw);
  }
}
