import {
  OPEN_ADDRESS_MESSAGE_MAX,
  OPEN_ADDRESS_OPTION,
  parseBrowserUrl,
  type ApprovalOption,
} from '@spark-outpost/contracts';
import type { RunObservations } from '../observations/run-observations.ts';
import { getApproval, type NewApproval } from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import type { AddressAsk, AddressReply, GateAnswer, QuestionGate } from '../providers/provider.ts';
import type { ApprovalGate } from './approval-gate.ts';
import { raiseWithdrawable } from './withdrawable-card.ts';

export const OPEN_ADDRESS_TITLE = 'Open this address?';

export const ADDRESS_OPTIONS: ApprovalOption[] = [
  { optionId: OPEN_ADDRESS_OPTION.open, name: 'Open', kind: 'allow_once' },
  { optionId: OPEN_ADDRESS_OPTION.dont, name: 'Don’t', kind: 'reject_once' },
];

function hostOf(url: string): string {
  return parseBrowserUrl(url)?.host ?? url;
}

export function addressCard(
  runId: string,
  ask: AddressAsk,
  observed: readonly string[],
): NewApproval {
  const host = hostOf(ask.url);
  return {
    runId,
    toolCallId: ask.toolCallId,
    rpcId: ask.rpcId,
    kind: 'other',
    title: OPEN_ADDRESS_TITLE,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      openAddress: {
        url: ask.url,
        host,
        message: ask.message.trim().slice(0, OPEN_ADDRESS_MESSAGE_MAX),
      },
      ...(ask.secretFiles.length > 0 ? { secretSend: [...ask.secretFiles] } : {}),
      ...(observed.length > 0 ? { observed: [...observed], sendsTo: `to ${host}` } : {}),
    },
    options: ADDRESS_OPTIONS,
    reason: null,
  };
}

async function addressReply(db: Db, answer: GateAnswer): Promise<AddressReply> {
  if (answer.outcome !== 'selected' || !answer.approvalId) return 'cancel';
  const approval = await getApproval(db, answer.approvalId);
  if (approval?.status === 'denied') return 'decline';
  const opened =
    approval?.status === 'allowed' && approval.decisionOptionId === OPEN_ADDRESS_OPTION.open;
  return opened ? 'accept' : 'cancel';
}

interface AddressDeps {
  db: Db;
  runId: string;
  gate: ApprovalGate;
  observations: RunObservations | undefined;
}

export function addressOpener(deps: AddressDeps): QuestionGate['open'] {
  return async (ask, signal, agentCancel) => {
    if (signal.aborted || agentCancel.aborted) return 'cancel';
    const observed = (await deps.observations?.labels()) ?? [];
    const card = addressCard(deps.runId, ask, observed);
    const answer = await raiseWithdrawable(deps.db, deps.gate, card, signal, agentCancel, (id) => {
      if (observed.length === 0) return;
      deps.observations?.egressAsked({
        approvalId: id,
        subject: `open ${card.payload.openAddress!.host}`,
        reason: null,
        observed,
        sendsTo: card.payload.sendsTo,
      });
    });
    return addressReply(deps.db, answer);
  };
}
