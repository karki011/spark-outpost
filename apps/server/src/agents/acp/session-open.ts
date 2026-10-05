import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';
import type {
  ProtocolObserver,
  ProviderOutput,
  SessionTarget,
  StoredSession,
} from '../../providers/provider.ts';

export type ResumeMethod = 'resume' | 'load';

export const FRESH_REASONS = {
  unsupported: "agent can't resume",
  repos: 'repos changed',
  failed: "couldn't resume",
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
  if (!sameWorkspace(stored, request)) return fresh(FRESH_REASONS.repos);
  try {
    const session = await reopen(ctx, method, request, stored.sessionId, replay);
    return { session, continued: true, freshReason: null };
  } catch (error) {
    if (signal.aborted) throw error;
    return fresh(FRESH_REASONS.failed);
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

export function sessionNote(
  opened: OpenedSession,
  target: Pick<SessionTarget, 'freshReason' | 'interrupted'>,
): string | null {
  if (opened.continued) return target.interrupted ? REOPENED_INTERRUPTED : 'Continued session';
  const reason = opened.freshReason ?? target.freshReason;
  if (target.interrupted) return freshAfterInterruption(reason);
  if (opened.freshReason === FRESH_REASONS.unsupported) return null;
  return reason ? `Fresh session (${reason})` : null;
}
