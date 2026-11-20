import { isRecord } from '../agent-config/records.ts';
import type { Db } from '../persistence/db.ts';
import { modHealth } from './mod-health.ts';
import { nativeHookHost, type TelemetryHandler } from './native-hook-host.ts';
import { hookTokenDigest as digest } from './native-observe.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { TerminalSessions } from './sessions.ts';
import { terminalApprovals } from './remote/approvals.ts';
import { modInbox } from './remote/mod-inbox.ts';
import { answerWaits, withMod } from './remote/mod-routing.ts';
import { nativeRemote, remoteHookHandlers } from './remote/native-remote.ts';

export interface NativeModHostDeps {
  db: Db;
  workspaceId: string;
  live: Map<string, LiveSession>;
  tokens: Map<string, LiveSession>;
  terminals: Pick<TerminalSessions, 'send' | 'screen'>;
  owned: (conversationId: string) => Promise<unknown>;
  hook: (token: string, body: unknown) => Promise<boolean>;
  telemetry: TelemetryHandler;
}

function sessionStarted(body: unknown): boolean {
  return (
    isRecord(body) && isRecord(body.payload) && body.payload.hook_event_name === 'SessionStart'
  );
}

export async function nativeModHost(deps: NativeModHostDeps) {
  const session = (token: string) => deps.tokens.get(digest(token));
  const approvals = terminalApprovals();
  const waitsForAnswer = answerWaits(approvals, deps.db);
  const health = modHealth({ db: deps.db });
  const mod = modInbox({
    db: deps.db,
    workspaceId: deps.workspaceId,
    waitsForAnswer,
    checkedIn: health.checkedIn,
  });
  const routed = withMod(
    nativeRemote({
      db: deps.db,
      workspaceId: deps.workspaceId,
      live: deps.live,
      terminals: deps.terminals,
      approvals,
      owned: deps.owned,
    }),
    mod,
    { db: deps.db, waitsForAnswer },
  );
  const remote = {
    ...routed,
    ended(conversationId: string): void {
      routed.ended(conversationId);
      health.ended(conversationId);
    },
  };
  const handlers = remoteHookHandlers(remote, session, deps.hook);
  const host = await nativeHookHost(
    (token) => deps.tokens.has(digest(token)),
    async (token, body) => {
      const accepted = await handlers.observe(token, body);
      const found = session(token);
      if (accepted && found && sessionStarted(body)) health.ready(found);
      return accepted;
    },
    handlers.permission,
    async (token, body) => {
      const found = session(token);
      return found ? mod.poll(found, body) : null;
    },
    deps.telemetry,
  );
  return {
    remote,
    host: {
      ...host,
      close: async () => {
        health.dispose();
        await host.close();
      },
    },
    launched: (live: LiveSession) => health.launched(live).catch(() => undefined),
  };
}
