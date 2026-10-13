import type {
  CreateShellResponse,
  NativeTerminalLaunchRequest,
  NativeTerminalLaunchResponse,
  NativeTerminalSession,
  NativeTerminalUsage,
} from '@spark-outpost/contracts';
import type { CliLocator } from '../agents/acp/agent-cli.ts';
import type { Db } from '../persistence/db.ts';
import type { NativeTerminalRow } from '../persistence/native-terminals.ts';
import type { SparkScope } from '../spark-mcp/deps.ts';
import type { SparkGrant, SparkMcpHost } from '../spark-mcp/host.ts';
import type { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import type { placeChat } from '../orchestration/chat-place.ts';
import type { NativeTurnContext } from './native-context.ts';
import type { WatchTranscript } from './native-tail.ts';
import type { SessionTranscript } from './native-usage.ts';
import type { prepareNativeLaunch, NativeLaunch } from './native-launch.ts';
import type { ShellFolder } from './shell-folder.ts';
import type { TerminalSessions } from './sessions.ts';
import type { TmuxHost } from './tmux/tmux-host.ts';

export interface NativeRuntimeDeps {
  db: Db;
  workspaceId: string;
  terminals: TerminalSessions;
  dataDir: string;
  channel: string;
  mcp: SparkMcpHost;
  locateCli?: CliLocator;
  branchPrefix?: string;
  approvalWaiters?: ApprovalWaiters;
  prepareLaunch?: typeof prepareNativeLaunch;
  place?: typeof placeChat;
  watchTranscript?: WatchTranscript;
  tmux?: TmuxHost | null;
  now?: () => Date;
}

export interface PendingNativeLaunch {
  key: string;
  work: Promise<NativeTerminalLaunchResponse>;
}

export interface NativeRuntime {
  port: number;
  get(conversationId: string): Promise<NativeTerminalSession | null>;
  launch(
    conversationId: string,
    request: NativeTerminalLaunchRequest,
  ): Promise<NativeTerminalLaunchResponse>;
  usage(conversationId: string): Promise<NativeTerminalUsage>;
  hook(token: string, body: unknown): Promise<boolean>;
  stop(conversationId: string): Promise<void>;
  stopAll(): Promise<void>;
  stopRun(runId: string): Promise<boolean>;
  stopSession(id: string): Promise<boolean>;
  attachSession(id: string): Promise<CreateShellResponse | null>;
  recover(): Promise<void>;
  detach(): Promise<void>;
  dispose(): Promise<void>;
}

export interface LiveSession {
  row: NativeTerminalRow;
  folder: ShellFolder;
  scope: SparkScope;
  grant: SparkGrant;
  launch: NativeLaunch;
  context: NativeTurnContext | null;
  mode: string | null;
  ceiling: string;
  seedPending: boolean;
  nativeSessionEnded: boolean;
  observedTurnId: string | null;
  chain: Promise<unknown>;
  hookKey: string;
  completedTurns: Set<string>;
  currentPromptEventId: string | null;
  completedEvents: Map<string, string | null>;
  transcript: SessionTranscript | null;
  readopted?: { at: string; stepsComplete: boolean };
}
