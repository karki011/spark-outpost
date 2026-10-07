import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';
import type {
  MissedMessage,
  ProtocolObserver,
  ProviderOutput,
  ProviderTurn,
  SessionTarget,
  StoredSession,
} from '../../providers/provider.ts';

export type ResumeMethod = 'resume' | 'load';

export const FRESH_REASONS = {
  unsupported: "agent can't resume",
  repos: 'repos changed',
  failed: "couldn't resume",
  gone: 'the agent no longer has the earlier session',
  listed: "the agent still has the earlier session but couldn't reopen it",
} as const;

const CLOSE_WAIT_MS = 3_000;

export interface OpenedSession {
  session: acp.ActiveSession;
  continued: boolean;
  freshReason: string | null;
}

export interface ReplayFilter {
  observer: ProtocolObserver | undefined;
  hold(): void;
  release(): void;
}

interface Attachable {
  attachSession(response: acp.NewSessionResponse): acp.ActiveSession;
}

export function resumeMethod(init: acp.InitializeResponse): ResumeMethod | null {
  const capabilities = init.agentCapabilities;
  const resume = capabilities?.sessionCapabilities?.resume;
  if (resume !== undefined && resume !== null) return 'resume';
  return capabilities?.loadSession === true ? 'load' : null;
}

export function supportsClose(init: acp.InitializeResponse): boolean {
  const close = init.agentCapabilities?.sessionCapabilities?.close;
  return close !== undefined && close !== null;
}

function isSessionUpdate(message: unknown): boolean {
  return (
    message !== null &&
    typeof message === 'object' &&
    (message as { method?: unknown }).method === acp.methods.client.session.update
  );
}

export function replayFilter(observer: ProtocolObserver | undefined): ReplayFilter {
  let holding = false;
  return {
    observer: observer && {
      message(direction, message) {
        if (holding && direction === 'from_agent' && isSessionUpdate(message)) return;
        observer.message(direction, message);
      },
      stderr: (chunk) => observer.stderr(chunk),
    },
    hold() {
      holding = true;
    },
    release() {
      holding = false;
    },
  };
}

const sorted = (values: readonly string[]) => [...values].sort();

export function sameWorkspace(stored: StoredSession, request: acp.NewSessionRequest): boolean {
  const wanted = sorted(request.additionalDirectories ?? []);
  const had = sorted(stored.additionalDirectories);
  return (
    stored.cwd === request.cwd &&
    wanted.length === had.length &&
    wanted.every((dir, index) => dir === had[index])
  );
}

async function reopen(
  ctx: acp.ClientContext,
  method: ResumeMethod,
  request: acp.NewSessionRequest,
  sessionId: string,
  replay: ReplayFilter,
): Promise<acp.ActiveSession> {
  const params = { ...request, sessionId };
  let response: acp.ResumeSessionResponse | acp.LoadSessionResponse;
  if (method === 'resume') {
    response = await ctx.request(acp.methods.agent.session.resume, params);
  } else {
    replay.hold();
    try {
      response = await ctx.request(acp.methods.agent.session.load, params);
    } finally {
      replay.release();
    }
  }
  return (ctx as unknown as Attachable).attachSession({ ...response, sessionId });
}

export async function openSession(
  ctx: acp.ClientContext,
  request: acp.NewSessionRequest,
  init: acp.InitializeResponse,
  stored: StoredSession | null,
  replay: ReplayFilter,
  signal: AbortSignal,
): Promise<OpenedSession> {
  const fresh = async (freshReason: string | null): Promise<OpenedSession> => ({
    session: await ctx.buildSession(request).start(),
    continued: false,
    freshReason,
  });
  if (!stored) return fresh(null);
  const method = resumeMethod(init);
  if (!method) return fresh(FRESH_REASONS.unsupported);
  if (!stored.anyFolder && !sameWorkspace(stored, request)) return fresh(FRESH_REASONS.repos);
  try {
    const session = await reopen(ctx, method, request, stored.sessionId, replay);
    return { session, continued: true, freshReason: null };
  } catch (error) {
    if (signal.aborted) throw error;
    return fresh(await whyResumeFailed(ctx, init, stored));
  }
}

export function listsSessions(init: acp.InitializeResponse): boolean {
  const list = init.agentCapabilities?.sessionCapabilities?.list;
  return list !== undefined && list !== null;
}

export async function whyResumeFailed(
  ctx: Pick<acp.ClientContext, 'request'>,
  init: acp.InitializeResponse,
  stored: StoredSession,
): Promise<string> {
  if (!listsSessions(init)) return FRESH_REASONS.failed;
  try {
    let cursor: string | null = null;
    do {
      const page: acp.ListSessionsResponse = await ctx.request(acp.methods.agent.session.list, {
        cwd: stored.cwd,
        ...(cursor ? { cursor } : {}),
      });
      if (page.sessions.some((session) => session.sessionId === stored.sessionId)) {
        return FRESH_REASONS.listed;
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return FRESH_REASONS.gone;
  } catch {
    return FRESH_REASONS.failed;
  }
}

export async function closeQuietly(
  ctx: acp.ClientContext,
  init: acp.InitializeResponse,
  sessionId: string,
): Promise<void> {
  if (!supportsClose(init)) return;
  const timer = new AbortController();
  try {
    await Promise.race([
      ctx.request(acp.methods.agent.session.close, { sessionId }).catch(() => undefined),
      delay(CLOSE_WAIT_MS, undefined, { signal: timer.signal }).catch(() => undefined),
    ]);
  } finally {
    timer.abort();
  }
}

export function sessionOutput(
  request: acp.NewSessionRequest,
  opened: OpenedSession,
  planned: string | null,
): ProviderOutput {
  return {
    kind: 'session',
    sessionId: opened.session.sessionId,
    cwd: request.cwd,
    additionalDirectories: [...(request.additionalDirectories ?? [])],
    continued: opened.continued,
    freshReason: opened.continued ? null : (opened.freshReason ?? planned),
  };
}

export const REOPENED_INTERRUPTED = 'Reopened the interrupted session';

export function freshAfterInterruption(reason: string | null): string {
  const why = reason ? ` (${reason})` : '';
  return `Couldn't reopen the interrupted session${why}, so this continues in a fresh one with the chat so far`;
}

export function handoffNote(reason: string | null): string {
  const why = reason ?? "the agent couldn't reopen the earlier one";
  return `Started a fresh agent session (${why}). It has a handoff of the goal, plan, changes and last three exchanges`;
}

export function sessionNote(
  opened: OpenedSession,
  target: Pick<SessionTarget, 'freshReason' | 'interrupted' | 'handoff'>,
): string | null {
  if (opened.continued) return target.interrupted ? REOPENED_INTERRUPTED : 'Continued session';
  const reason = opened.freshReason ?? target.freshReason;
  if (target.interrupted) return freshAfterInterruption(reason);
  if (target.handoff) return handoffNote(reason);
  if (opened.freshReason === FRESH_REASONS.unsupported) return null;
  return reason ? `Fresh session (${reason})` : null;
}

const MISSED_SHOWN = 6;
const MISSED_LIMIT = 1_500;

export const CATCH_UP_HEADING = 'Since your last turn in this chat (you did not see these):';

function clipped(text: string): string {
  return text.length > MISSED_LIMIT ? `${text.slice(0, MISSED_LIMIT)}…` : text;
}

export function catchUp(missed: readonly MissedMessage[], request: string): string {
  if (missed.length === 0) return request;
  const shown = missed.slice(-MISSED_SHOWN);
  const earlier = missed.length - shown.length;
  const lines = shown.map(
    (message) =>
      `${message.role === 'user' ? 'User' : 'Reply shown to the user'}: ${clipped(message.content)}`,
  );
  const head = earlier > 0 ? [`(${earlier} earlier messages left out)`] : [];
  return [CATCH_UP_HEADING, ...head, ...lines, 'Now:', request].join('\n\n');
}

export function afterOpening(turn: ProviderTurn, continued: boolean): ProviderTurn {
  const target = turn.session;
  if (continued) {
    const missed = target?.missed ?? [];
    if (!target || missed.length === 0) return { ...turn, history: [] };
    const followUp = catchUp(missed, target.followUp ?? turn.prompt);
    return { ...turn, history: [], session: { ...target, followUp } };
  }
  if (!target?.handoff) return turn;
  const preamble = [target.handoff, turn.preamble].filter(Boolean).join('\n\n');
  return { ...turn, history: [], preamble };
}
