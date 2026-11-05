import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  terminalProviderName,
  type NativeTerminalLaunchRequest,
  type NativeTerminalLaunchResponse,
  type NativeTerminalProvider,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  nativeTerminalRow,
  nativeTerminalView,
  type NativeTerminalRow,
} from '../persistence/native-terminals.ts';
import { STOPPED_BY_USER } from '../persistence/native-terminal-usage.ts';
import {
  reserveNativeTerminalLaunch,
  setNativeTerminalState,
} from '../persistence/native-terminal-turns.ts';
import { nativeLaunchError, NativeRuntimeError } from './native-control.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { AgentRequest } from './session-types.ts';
import type { TerminalSessions } from './sessions.ts';
import { shellFolder, type ShellFolder } from './shell-folder.ts';
import type { StartTimer } from './start-timing.ts';

export const UNTRACKED_REASON = 'Spark records only whether this session is running.';

export function untrackedSession(
  workspaceId: string,
  row: NativeTerminalRow,
  folder: ShellFolder,
): LiveSession {
  return {
    row,
    folder,
    scope: { workspaceId, conversationId: row.conversation_id, runId: null, readOnly: true },
    grant: { url: '', token: '', revoke: () => undefined },
    launch: {
      command: row.provider,
      args: [],
      env: {},
      observation: 'unsupported',
      version: '',
      dispose: async () => undefined,
    },
    context: null,
    mode: null,
    ceiling: '',
    seedPending: false,
    nativeSessionEnded: false,
    observedTurnId: null,
    chain: Promise.resolve(),
    hookKey: '',
    completedTurns: new Set(),
    currentPromptEventId: null,
    completedEvents: new Map(),
    transcript: null,
  };
}

async function untrackedFolder(
  input: Pick<UntrackedLaunchInput, 'db' | 'workspaceId' | 'dataDir' | 'channel'>,
  conversationId: string,
): Promise<ShellFolder> {
  const located = await shellFolder(input.db, input.workspaceId, conversationId);
  if (located.kind !== 'home') return located;
  const cwd = join(input.dataDir, input.channel, 'terminal-workspaces', conversationId);
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  return { cwd, label: 'Spark session', kind: 'home', note: located.note };
}

export interface UntrackedLaunchInput {
  db: Db;
  workspaceId: string;
  dataDir: string;
  channel: string;
  terminals: TerminalSessions;
  live: Map<string, LiveSession>;
  conversationId: string;
  provider: NativeTerminalProvider;
  command: string;
  request: NativeTerminalLaunchRequest;
  previous: NativeTerminalRow | null;
  timer: Pick<StartTimer, 'session' | 'observer'>;
  onExit: (session: LiveSession) => NonNullable<AgentRequest['onExit']>;
  stopped: () => boolean;
}

export async function launchUntracked(
  input: UntrackedLaunchInput,
): Promise<NativeTerminalLaunchResponse> {
  const { db, conversationId, provider } = input;
  if (input.request.prompt)
    throw new NativeRuntimeError(
      `${terminalProviderName(provider)} starts without a first message. Type it in the terminal once it opens.`,
    );
  const folder = await untrackedFolder(input, conversationId);
  const row = await reserveNativeTerminalLaunch(db, {
    id: input.previous?.id ?? randomUUID(),
    conversationId,
    provider,
    cwd: folder.cwd,
    label: folder.label,
    runId: null,
    messageId: null,
    resume: false,
    observation: 'unsupported',
    reason: UNTRACKED_REASON,
  }).catch((error: unknown) => {
    throw nativeLaunchError(error);
  });
  input.timer.session(row.id);
  const session = untrackedSession(input.workspaceId, row, folder);
  try {
    input.live.set(conversationId, session);
    await setNativeTerminalState(db, { ...row, state: 'unknown', reason: UNTRACKED_REASON });
    if (input.stopped() || input.live.get(conversationId) !== session)
      throw new NativeRuntimeError('This terminal launch was stopped.', 409);
    const connection = input.terminals.createAgent({
      id: row.id,
      conversationId,
      cwd: row.cwd,
      label: row.label,
      command: input.command,
      args: [],
      env: {},
      colors: input.request.colors,
      observer: input.timer.observer,
      onExit: input.onExit(session),
    });
    return {
      session: nativeTerminalView((await nativeTerminalRow(db, conversationId))!),
      connection: { ...connection, ...folder },
    };
  } catch (error) {
    input.terminals.kill(row.id);
    if (input.live.get(conversationId) === session) input.live.delete(conversationId);
    const cancelled = input.stopped();
    const failure = nativeLaunchError(error);
    await setNativeTerminalState(db, {
      ...row,
      state: cancelled ? 'exited' : 'error',
      reason: cancelled ? STOPPED_BY_USER : failure.message,
    });
    throw failure;
  }
}
