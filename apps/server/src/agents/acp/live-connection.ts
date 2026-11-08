import { setImmediate as nextTick } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk/unstable';
import type { AgentLaunch } from './agents.ts';
import { startAgentProcess, type AgentProcess } from './agent-process.ts';
import type { SettingsSession } from './apply-settings.ts';
import { AUTH_STATUS_METHOD, parseAuthStatus } from './auth-status.ts';
import { createBackgroundWork, type BackgroundWork } from './background-work.ts';
import { CLIENT_INFO } from './client-info.ts';
import type { ConnectionKey } from './connection-key.ts';
import {
  createBindingSlot,
  createMessageQueue,
  reboundObserver,
  type MessageQueue,
  type TurnHandlers,
} from './live-binding.ts';
import { startsAgentCycle } from './agent-cycle.ts';
import { parseRequestUsage, SDK_MESSAGE_METHOD } from './request-usage.ts';
import type { RequestUsage } from '../../providers/provider.ts';
import type { LiveTools } from './live-tools.ts';
import { closeQuietly, deleteQuietly } from './session-open.ts';
import { routeSubagents } from './subagent-stream.ts';

export type SessionMessage = Awaited<ReturnType<acp.ActiveSession['nextUpdate']>>;

export interface ConnectionSpec {
  launch: AgentLaunch;
  cwd: string;
  home: string;
  env: Record<string, string>;
  readsFiles: boolean;
  tracksBackground: boolean;
  key: ConnectionKey | null;
  cleanup: () => Promise<void>;
}

export interface OpenedSession {
  init: acp.InitializeResponse;
  session: acp.ActiveSession;
  request: acp.NewSessionRequest;
}

export interface LiveConnection {
  readonly agent: AgentProcess;
  readonly ctx: acp.ClientContext;
  readonly key: ConnectionKey | null;
  readonly background: BackgroundWork | null;
  readonly updates: MessageQueue<SessionMessage>;
  readonly home: string;
  tools: LiveTools | null;
  opened(): OpenedSession | null;
  whenBound(): Promise<void>;
  attach(opened: OpenedSession): void;
  settings(): SettingsSession | null;
  keepSettings(settings: SettingsSession): void;
  bind(handlers: TurnHandlers): () => void;
  bound(): boolean;
  gone(): boolean;
  waiting(): boolean;
  onUnbound(listener: () => void): void;
  onGone(listener: () => void): void;
  close(): Promise<void>;
  discard(): Promise<void>;
  kill(): Promise<void>;
}

class ConnectionClosed extends Error {
  constructor() {
    super('The live agent session has closed.');
  }
}

export async function startLiveConnection(spec: ConnectionSpec): Promise<LiveConnection> {
  const tap = reboundObserver();
  const unboundListeners = new Set<() => void>();
  const goneListeners = new Set<() => void>();
  let isGone = false;
  let wanted = false;
  const signalUnbound = () => {
    if (wanted || !spec.tracksBackground) return;
    wanted = true;
    for (const listener of unboundListeners) listener();
  };
  const slot = createBindingSlot(signalUnbound);
  const updates = createMessageQueue<SessionMessage>();
  const heldRequests: RequestUsage[] = [];
  const agent = startAgentProcess(spec.launch, spec.cwd, spec.env, tap.observer);
  const handle = <T>(use: (handlers: TurnHandlers) => Promise<T> | T) => slot.handlers().then(use);
  const client = acp
    .client(CLIENT_INFO)
    .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
      handle((handlers) => handlers.permission(ctx.params, ctx.requestId)),
    )
    .onRequest(acp.methods.client.elicitation.create, (ctx) =>
      handle((handlers) => handlers.question(ctx.params, ctx.requestId, ctx.signal)),
    )
    .onRequest(acp.methods.client.fs.writeTextFile, (ctx) =>
      handle((handlers) => handlers.write(ctx.params)),
    )
    .onNotification(AUTH_STATUS_METHOD, parseAuthStatus, ({ params }) => {
      if (params) slot.current()?.account(params);
    })
    .onNotification(SDK_MESSAGE_METHOD, parseRequestUsage, ({ params }) => {
      if (!params) return;
      const bound = slot.current();
      if (bound) bound.request(params);
      else heldRequests.push(params);
    });
  if (spec.readsFiles) {
    client.onRequest(acp.methods.client.fs.readTextFile, (ctx) =>
      handle((handlers) => handlers.read(ctx.params)),
    );
  }
  let ready: (ctx: acp.ClientContext) => void = () => undefined;
  const connected = new Promise<acp.ClientContext>((resolve) => {
    ready = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = client.connectWith(routeSubagents(agent.stream), async (ctx) => {
    ready(ctx);
    await released;
  });
  let ended = false;
  void done
    .catch(() => undefined)
    .finally(() => {
      ended = true;
    });
  let opened: OpenedSession | null = null;
  let settings: SettingsSession | null = null;
  let cleaned: Promise<void> | null = null;
  const cleanup = () => {
    cleaned ??= spec.cleanup().catch(() => undefined);
    return cleaned;
  };
  let self: LiveConnection | null = null;
  const markGone = (): Promise<void> => {
    if (isGone) return cleanup();
    isGone = true;
    self?.tools?.grant.revoke();
    slot.close(new ConnectionClosed());
    updates.fail(new ConnectionClosed());
    release();
    opened?.session.dispose();
    for (const listener of goneListeners) listener();
    return cleanup();
  };
  agent.exited.catch(() => markGone());
  const ctx = await Promise.race([connected, agent.exited]).catch((error: unknown) => {
    void agent.kill();
    void markGone();
    throw error;
  });
  const background = spec.tracksBackground ? createBackgroundWork() : null;

  const pump = async (session: acp.ActiveSession) => {
    while (!isGone) {
      let message: SessionMessage;
      try {
        message = await session.nextUpdate();
      } catch {
        await nextTick();
        if (isGone || ended) return;
        continue;
      }
      updates.push(message);
      if (
        !slot.current() &&
        message.kind === 'session_update' &&
        startsAgentCycle(message.update)
      ) {
        signalUnbound();
      }
    }
  };

  self = {
    agent,
    ctx,
    key: spec.key,
    background,
    updates,
    home: spec.home,
    tools: null,
    opened: () => opened,
    whenBound: () => slot.handlers().then(() => undefined),
    attach(next) {
      opened = next;
      void pump(next.session);
    },
    settings: () => settings,
    keepSettings(next) {
      settings = next;
    },
    bind(handlers) {
      const unbind = slot.bind(handlers);
      const unbindAudit = tap.bind(handlers.audit);
      wanted = false;
      for (const usage of heldRequests.splice(0)) handlers.request(usage);
      return () => {
        updates.release();
        unbind();
        setImmediate(unbindAudit);
      };
    },
    bound: () => slot.current() !== null,
    gone: () => isGone,
    waiting: () => wanted,
    onUnbound(listener) {
      unboundListeners.add(listener);
      if (wanted) listener();
    },
    onGone(listener) {
      goneListeners.add(listener);
    },
    async close() {
      if (!isGone && opened) await closeQuietly(ctx, opened.init, opened.session.sessionId);
      const killing = agent.kill();
      await markGone();
      await killing;
    },
    async discard() {
      if (!isGone && opened) await deleteQuietly(ctx, opened.init, opened.session.sessionId);
      const killing = agent.kill();
      await markGone();
      await killing;
    },
    async kill() {
      const killing = agent.kill();
      await markGone();
      await killing;
    },
  };
  return self;
}
