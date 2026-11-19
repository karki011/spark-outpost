import type { TerminalApprovalDecision } from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { nativeTerminalRow } from '../../persistence/native-terminals.ts';
import { NativeRuntimeError } from '../native-control.ts';
import type { TerminalApprovals } from './approvals.ts';
import type { ModInbox } from './mod-inbox.ts';
import { runsCliCommand, withoutControls, type NativeRemote } from './native-remote.ts';

const WAITS_FOR_ANSWER = new Set(['waiting_for_permission', 'waiting_for_input']);
export const ABORT_SETTLE_MS = 3_000;
const ABORT_CHECK_MS = 250;
const ASKED_FIRST =
  'The agent asked something before your message was sent. Answer it first; your message wasn’t sent.';

export function answerWaits(approvals: Pick<TerminalApprovals, 'current'>, db: Db) {
  return async (conversationId: string): Promise<boolean> => {
    if (approvals.current(conversationId)) return true;
    const row = await nativeTerminalRow(db, conversationId);
    return row === null || WAITS_FOR_ANSWER.has(row.state);
  };
}

export interface ModRouting {
  db: Db;
  waitsForAnswer: (conversationId: string) => Promise<boolean>;
  delay?: (ms: number) => Promise<void>;
}

export function withMod(remote: NativeRemote, mod: ModInbox, routing: ModRouting) {
  const { db, waitsForAnswer } = routing;
  const delay = routing.delay ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const workingTurn = async (conversationId: string): Promise<string | null> => {
    const row = await nativeTerminalRow(db, conversationId);
    return row?.state === 'working' ? row.native_turn_id : null;
  };
  const currentTurn = async (conversationId: string): Promise<string | null> =>
    (await nativeTerminalRow(db, conversationId))?.native_turn_id ?? null;
  const settled = async (conversationId: string, prompt: string): Promise<boolean> => {
    for (let waited = 0; waited < ABORT_SETTLE_MS; waited += ABORT_CHECK_MS) {
      if ((await workingTurn(conversationId)) !== prompt) return true;
      await delay(ABORT_CHECK_MS);
    }
    return (await workingTurn(conversationId)) !== prompt;
  };
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

    async interrupt(conversationId: string): Promise<void> {
      const prompt = mod.aborts(conversationId) ? await workingTurn(conversationId) : null;
      if (prompt) {
        const taken = await mod.stop(conversationId, prompt);
        if (taken && (await settled(conversationId, prompt))) return;
        if ((await currentTurn(conversationId)) !== prompt) return;
      }
      await remote.interrupt(conversationId);
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
