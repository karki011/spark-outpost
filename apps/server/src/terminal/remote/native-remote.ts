import { stat } from 'node:fs/promises';
import type {
  TerminalApprovalDecision,
  TerminalRemoteView,
  TerminalTranscriptItem,
} from '@spark-outpost/contracts';
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
import { inputDetail, transcriptItems } from './transcript-items.ts';

export const SHOWN_ITEMS = 150;
export const SUBMIT_DELAY_MS = 400;
const APPROVAL_DETAIL_MAX = 2_000;
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const ESCAPE = '\u001b';
const CODEX_MENU = /press enter to confirm or esc to cancel/i;
const MENU_FOOTER = /esc to (?:cancel|go back)/i;
const MENU_LINES = 15;
const COMMAND_PREFIX = /^\s*[/!]/;
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m;
const NOT_RUNNING = 'This Terminal session isn’t running. Start it again on your Mac.';
const CHANGED = 'This approval has changed. Check the session again.';
const WAITING = 'The agent is waiting for an answer. Answer it first, then send your message.';

export interface NativeRemoteDeps {
  db: Db;
  workspaceId: string;
  live: Map<string, LiveSession>;
  terminals: Pick<TerminalSessions, 'send' | 'screen'>;
  approvals: TerminalApprovals;
  owned: (conversationId: string) => Promise<unknown>;
  delay?: (ms: number) => Promise<void>;
}

interface ParsedTail {
  path: string;
  size: number;
  modified: number;
  items: TerminalTranscriptItem[];
  truncated: boolean;
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
  const file = tool === 'apply_patch' && typeof patch === 'string' ? PATCH_FILE.exec(patch) : null;
  return file?.[1]?.trim() ?? inputDetail(input, APPROVAL_DETAIL_MAX);
}

function squashed(text: string): string {
  return text.replace(/\s+/g, '');
}

export function menuOpen(screen: string): boolean {
  const bottom = screen
    .split('\n')
    .filter((line) => line.trim())
    .slice(-MENU_LINES)
    .join('\n');
  return MENU_FOOTER.test(bottom);
}

export function codexMenuShows(screen: string, detail: string): boolean {
  if (!CODEX_MENU.test(screen)) return false;
  const key = squashed(detail).slice(0, 60);
  return key.length === 0 || squashed(screen).includes(key);
}

export function nativeRemote(deps: NativeRemoteDeps) {
  const delay = deps.delay ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const parsed = new Map<string, ParsedTail>();
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
  const items = async (
    conversationId: string,
    provider: LiveSession['row']['provider'],
    path: string,
  ): Promise<ParsedTail | null> => {
    const file = await stat(path).catch(() => null);
    if (!file) return null;
    const cached = parsed.get(conversationId);
    if (cached?.path === path && cached.size === file.size && cached.modified === file.mtimeMs)
      return cached;
    const tail = await readTail(path).catch(() => null);
    if (!tail) return null;
    const all = transcriptItems(provider, tail.lines);
    const fresh = {
      path,
      size: tail.size,
      modified: tail.modified,
      items: all.slice(-SHOWN_ITEMS),
      truncated: tail.truncated || all.length > SHOWN_ITEMS,
    };
    parsed.set(conversationId, fresh);
    return fresh;
  };

  return {
    async view(conversationId: string): Promise<TerminalRemoteView> {
      await deps.owned(conversationId);
      const row = await nativeTerminalRow(deps.db, conversationId);
      if (!row) throw new NativeRuntimeError('This chat has no Terminal session.', 404);
      const session = deps.live.get(conversationId);
      const path = session?.transcript?.path ?? row.usage_file ?? null;
      const tail = path ? await items(conversationId, row.provider, path) : null;
      const pending = session ? deps.approvals.current(conversationId) : null;
      return {
        provider: row.provider,
        state: row.state,
        running: session !== undefined,
        items: tail?.items ?? [],
        truncated: tail?.truncated ?? false,
        approval: pending
          ? {
              id: pending.id,
              tool: pending.tool,
              detail: pending.detail,
              denyStopsTurn: pending.provider === 'codex',
            }
          : null,
      };
    },

    async message(conversationId: string, text: string): Promise<void> {
      const session = running(conversationId);
      if (COMMAND_PREFIX.test(text))
        throw new NativeRuntimeError(
          'Messages that start with / or ! run CLI commands. Type them on your Mac.',
          409,
        );
      if (deps.approvals.current(conversationId)) throw new NativeRuntimeError(WAITING, 409);
      const [row, screen] = await Promise.all([
        nativeTerminalRow(deps.db, conversationId),
        deps.terminals.screen(session.row.id),
      ]);
      if (
        row?.state === 'waiting_for_permission' ||
        row?.state === 'waiting_for_input' ||
        (screen !== null && menuOpen(screen))
      )
        throw new NativeRuntimeError(WAITING, 409);
      write(session, pastedMessage(text));
      await delay(SUBMIT_DELAY_MS);
      write(session, '\r');
    },

    async interrupt(conversationId: string): Promise<void> {
      const session = running(conversationId);
      const row = await nativeTerminalRow(deps.db, conversationId);
      if (row?.state !== 'working')
        throw new NativeRuntimeError('The agent isn’t working, so there is nothing to stop.', 409);
      write(session, ESCAPE);
    },

    async decide(conversationId: string, decision: TerminalApprovalDecision): Promise<void> {
      const session = running(conversationId);
      const current = deps.approvals.current(conversationId);
      if (!current || current.id !== decision.id) throw new NativeRuntimeError(CHANGED, 409);
      const byKey = current.provider === 'codex';
      if (byKey) {
        const screen = await deps.terminals.screen(session.row.id);
        if (screen === null) throw new NativeRuntimeError('Answer this on your Mac.', 409);
        if (!codexMenuShows(screen, current.detail)) throw new NativeRuntimeError(CHANGED, 409);
      }
      const taken = deps.approvals.take(conversationId, decision.id);
      if (!taken) throw new NativeRuntimeError(CHANGED, 409);
      taken.settle(decision.decision);
      if (byKey) write(session, decision.decision === 'allow' ? 'y' : ESCAPE);
    },

    async permission(
      session: LiveSession,
      body: unknown,
      signal: AbortSignal,
    ): Promise<ApprovalAnswer | null> {
      if (!isRecord(body) || typeof body.tool !== 'string' || body.tool.length > 200) return null;
      if (!(await remoteAccess(deps.db, deps.workspaceId)).switches.terminalApprove) return null;
      const request = {
        conversationId: session.row.conversation_id,
        provider: session.row.provider,
        tool: body.tool,
        detail: approvalDetail(body.tool, body.input),
      };
      if (request.provider === 'codex') {
        deps.approvals.note(request);
        return null;
      }
      return deps.approvals.wait(request, { signal, timeoutMs: CLAUDE_PERMISSION_WAIT_MS });
    },

    observed(session: LiveSession, eventName: unknown): void {
      if (typeof eventName === 'string' && SETTLED_BY.has(eventName))
        deps.approvals.clear(session.row.conversation_id);
    },

    ended(conversationId: string): void {
      deps.approvals.clear(conversationId);
      parsed.delete(conversationId);
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
