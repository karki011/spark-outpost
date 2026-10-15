import type { TerminalApprovalDecision } from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { nativeTerminalRow } from '../../persistence/native-terminals.ts';
import type { TerminalApprovals } from './approvals.ts';
import type { ModInbox } from './mod-inbox.ts';
import { COMMAND_PREFIX, type NativeRemote } from './native-remote.ts';

const WAITS_FOR_ANSWER = new Set(['waiting_for_permission', 'waiting_for_input']);

export function withMod(
  remote: NativeRemote,
  mod: ModInbox,
  approvals: Pick<TerminalApprovals, 'current'>,
  db: Db,
) {
  const modTakes = async (conversationId: string, text: string): Promise<boolean> => {
    if (!mod.active(conversationId) || COMMAND_PREFIX.test(text)) return false;
    if (approvals.current(conversationId)) return false;
    const row = await nativeTerminalRow(db, conversationId);
    return row !== null && !WAITS_FOR_ANSWER.has(row.state);
  };

  return {
    ...remote,

    view(conversationId: string, byDevice = false) {
      if (byDevice) mod.followed(conversationId);
      return remote.view(conversationId);
    },

    async message(...args: Parameters<NativeRemote['message']>): Promise<void> {
      const [conversationId, text, ...options] = args;
      if (
        !options.some(Boolean) &&
        (await modTakes(conversationId, text)) &&
        (await mod.send(conversationId, text))
      )
        return;
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
