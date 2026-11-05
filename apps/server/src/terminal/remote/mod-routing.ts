import type { TerminalApprovalDecision } from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { nativeTerminalRow } from '../../persistence/native-terminals.ts';
import { NativeRuntimeError } from '../native-control.ts';
import type { TerminalApprovals } from './approvals.ts';
import type { ModInbox } from './mod-inbox.ts';
import { runsCliCommand, withoutControls, type NativeRemote } from './native-remote.ts';

const WAITS_FOR_ANSWER = new Set(['waiting_for_permission', 'waiting_for_input']);
const ASKED_FIRST =
  'The agent asked something before your message was sent. Answer it first; your message wasn’t sent.';

export function answerWaits(approvals: Pick<TerminalApprovals, 'current'>, db: Db) {
  return async (conversationId: string): Promise<boolean> => {
    if (approvals.current(conversationId)) return true;
    const row = await nativeTerminalRow(db, conversationId);
    return row === null || WAITS_FOR_ANSWER.has(row.state);
  };
}

export function withMod(
  remote: NativeRemote,
  mod: ModInbox,
  waitsForAnswer: (conversationId: string) => Promise<boolean>,
) {
  const modTakes = async (conversationId: string, text: string): Promise<boolean> =>
    mod.active(conversationId) && !runsCliCommand(text) && !(await waitsForAnswer(conversationId));

  return {
    ...remote,

    view(conversationId: string, byDevice = false) {
      if (byDevice) mod.followed(conversationId);
      return remote.view(conversationId);
    },

    async message(...args: Parameters<NativeRemote['message']>): Promise<void> {
      const [conversationId, text, ...options] = args;
      if (!options.some(Boolean) && (await modTakes(conversationId, text))) {
        const outcome = await mod.send(conversationId, withoutControls(text));
        if (outcome === 'taken') return;
        if (outcome === 'refused') throw new NativeRuntimeError(ASKED_FIRST, 409);
      }
      await remote.message(...args);
    },

    async decide(conversationId: string, decision: TerminalApprovalDecision): Promise<void> {
      await remote.decide(conversationId, decision);
      mod.decided(conversationId, decision.decision);
    },

    ended(conversationId: string): void {
      remote.ended(conversationId);
      mod.ended(conversationId);
    },
  };
}

export type ModRoutedRemote = ReturnType<typeof withMod>;
