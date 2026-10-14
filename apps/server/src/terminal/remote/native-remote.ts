import type { TerminalApprovalDecision, TerminalRemoteView } from '@spark-outpost/contracts';
import { isRecord } from '../../agent-config/records.ts';
import type { Db } from '../../persistence/db.ts';
import { nativeTerminalRow } from '../../persistence/native-terminals.ts';
import { remoteAccess } from '../../remote/store.ts';
import { NativeRuntimeError } from '../native-control.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import type { TerminalSessions } from '../sessions.ts';
import {
  CLAUDE_PERMISSION_WAIT_MS,
  type ApprovalAnswer,
  type TerminalApprovals,
} from './approvals.ts';
import { readTail } from './read-tail.ts';
import { transcriptItems } from './transcript-items.ts';

export const SHOWN_ITEMS = 150;
export const SUBMIT_DELAY_MS = 400;
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const ESCAPE = '\u001b';
const CODEX_MENU = /press enter to confirm or esc to cancel/i;
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m;
const NOT_RUNNING = 'This Terminal session isn’t running. Start it again on your Mac.';
const CHANGED = 'This approval has changed. Check the session again.';
const ON_THE_MAC = 'Answer this on your Mac.';

export interface NativeRemoteDeps {
  db: Db;
  workspaceId: string;
  live: Map<string, LiveSession>;
  terminals: Pick<TerminalSessions, 'send' | 'screen'>;
  approvals: TerminalApprovals;
  delay?: (ms: number) => Promise<void>;
}

export function pastedMessage(text: string): string {
  const clean = Array.from(text.replace(/\r\n?/g, '\n'))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f);
    })
    .join('');
  return `${PASTE_START}${clean}${PASTE_END}`;
}

export function approvalDetail(tool: string, input: unknown): string {
  const patch = typeof input === 'string' ? input : isRecord(input) ? input.command : null;
  if (tool === 'apply_patch' && typeof patch === 'string') {
    const file = PATCH_FILE.exec(patch)?.[1];
    if (file) return file.trim();
  }
  if (!isRecord(input)) return typeof input === 'string' ? input.slice(0, 2_000) : '';
  for (const key of ['command', 'cmd', 'file_path', 'path', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 2_000);
  }
  return '';
}

function squashed(text: string): string {
  return text.replace(/\s+/g, '');
}

export function codexMenuShows(screen: string, detail: string): boolean {
  if (!CODEX_MENU.test(screen)) return false;
  const key = squashed(detail).slice(0, 60);
  return key.length === 0 || squashed(screen).includes(key);
}

export function nativeRemote(deps: NativeRemoteDeps) {
  const delay = deps.delay ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const running = (conversationId: string) => {
    const session = deps.live.get(conversationId);
    if (!session) throw new NativeRuntimeError(NOT_RUNNING, 409);
    return session;
  };
  const write = (session: LiveSession, data: string) => {
    if (!deps.terminals.send(session.row.id, data))
      throw new NativeRuntimeError(
        'Open this Terminal session on your Mac once, then try again.',
        409,
      );
  };
  const approvalsOn = async () =>
    (await remoteAccess(deps.db, deps.workspaceId)).switches.terminalApprove;

  return {
    async view(conversationId: string): Promise<TerminalRemoteView> {
      const row = await nativeTerminalRow(deps.db, conversationId);
      if (!row) throw new NativeRuntimeError('This chat has no Terminal session.', 404);
      const session = deps.live.get(conversationId);
      const path = session?.transcript?.path ?? row.usage_file ?? null;
      const tail = path
        ? await readTail(path).catch(() => ({ lines: [], truncated: false }))
        : { lines: [], truncated: false };
      const items = transcriptItems(row.provider, tail.lines);
      const pending = session ? deps.approvals.current(conversationId) : null;
      return {
        provider: row.provider,
        state: row.state,
        running: session !== undefined,
        items: items.slice(-SHOWN_ITEMS),
        truncated: tail.truncated || items.length > SHOWN_ITEMS,
        approval: pending
          ? {
              id: pending.id,
              tool: pending.tool,
              detail: pending.detail,
              denyStopsTurn: pending.denyStopsTurn,
            }
          : null,
        approvalsHere: session?.remoteApprovals === true,
      };
    },

    async message(conversationId: string, text: string): Promise<void> {
      const session = running(conversationId);
      const row = await nativeTerminalRow(deps.db, conversationId);
      if (
        deps.approvals.current(conversationId) ||
        row?.state === 'waiting_for_permission' ||
        row?.state === 'waiting_for_input'
      )
        throw new NativeRuntimeError(
          'The agent is waiting for an answer. Answer it first, then send your message.',
          409,
        );
      write(session, pastedMessage(text));
      await delay(SUBMIT_DELAY_MS);
      write(session, '\r');
    },

    interrupt(conversationId: string): void {
      write(running(conversationId), ESCAPE);
    },

    async decide(conversationId: string, decision: TerminalApprovalDecision): Promise<void> {
      const session = running(conversationId);
      const current = deps.approvals.current(conversationId);
      if (!current || current.id !== decision.id) throw new NativeRuntimeError(CHANGED, 409);
      if (current.via === 'hook') {
        deps.approvals.take(conversationId, decision.id)?.settle(decision.decision);
        return;
      }
      const screen = await deps.terminals.screen(session.row.id);
      if (screen === null) throw new NativeRuntimeError(ON_THE_MAC, 409);
      if (!codexMenuShows(screen, current.detail)) throw new NativeRuntimeError(CHANGED, 409);
      if (!deps.approvals.take(conversationId, decision.id))
        throw new NativeRuntimeError(CHANGED, 409);
      write(session, decision.decision === 'allow' ? 'y' : ESCAPE);
    },

    async permission(
      session: LiveSession,
      body: unknown,
      signal: AbortSignal,
    ): Promise<ApprovalAnswer | null> {
      if (!isRecord(body) || typeof body.tool !== 'string' || body.tool.length > 200) return null;
      if (!session.remoteApprovals || !(await approvalsOn())) return null;
      const request = {
        conversationId: session.row.conversation_id,
        sessionId: session.row.id,
        provider: session.row.provider,
        tool: body.tool,
        detail: approvalDetail(body.tool, body.input),
      };
      if (session.row.provider === 'codex') {
        deps.approvals.noteKeys(request);
        return null;
      }
      return deps.approvals.wait(request, { signal, timeoutMs: CLAUDE_PERMISSION_WAIT_MS });
    },

    observed(session: LiveSession, eventName: unknown): void {
      if (typeof eventName === 'string' && SETTLED_BY.has(eventName))
        deps.approvals.clear(session.row.conversation_id);
    },

    clear(conversationId: string): void {
      deps.approvals.clear(conversationId);
    },
  };
}

export function remoteHookHandlers(
  remote: Pick<NativeRemote, 'permission' | 'observed'>,
  session: (token: string) => LiveSession | undefined,
  hook: (token: string, body: unknown) => Promise<boolean>,
) {
  return {
    observe: async (token: string, body: unknown) => {
      const accepted = await hook(token, body);
      const found = session(token);
      if (accepted && found && isRecord(body) && isRecord(body.payload))
        remote.observed(found, body.payload.hook_event_name);
      return accepted;
    },
    permission: (token: string, body: unknown, signal: AbortSignal) => {
      const found = session(token);
      return found ? remote.permission(found, body, signal) : Promise.resolve(null);
    },
  };
}

const SETTLED_BY = new Set([
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'UserPromptSubmit',
  'SessionEnd',
  'Interrupt',
]);

export type NativeRemote = ReturnType<typeof nativeRemote>;
