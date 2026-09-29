import type {
  AgentCommand,
  AgentModeOption,
  ConfigOptionInfo,
  ConfigValues,
  PlanEntry,
  ProtocolDirection,
  RunMode,
  SparkSessionPrefs,
  TaskLinkSource,
  TokenUsage,
} from '@spark-outpost/contracts';
import type { RepoLaunch } from '../agent-config/launch.ts';
import type { UserMcpLaunch } from '../mcp/launch.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';

export interface TurnAttachment {
  name: string;
  mediaType: string;
  kind: 'image' | 'text';
  data: Buffer;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly TurnAttachment[];
}

export interface AgentSettings {
  method: 'cli' | 'api_key' | null;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
  mode?: string | null;
  options?: ConfigValues;
}

export interface ModeRequests {
  subscribe(listener: (mode: string) => void): () => void;
}

export interface StoredSession {
  sessionId: string;
  cwd: string;
  additionalDirectories: readonly string[];
  commands?: readonly string[];
}

export interface SessionTarget {
  workdir: string | null;
  resume: StoredSession | null;
  freshReason: string | null;
  followUp?: string;
}

export interface ProviderTurn {
  prompt: string;
  attachments?: readonly TurnAttachment[];
  history: ConversationTurn[];
  settings: AgentSettings;
  projectRoots?: readonly string[];
  signal: AbortSignal;
  audit?: ProtocolObserver;
  mode?: RunMode;
  builder?: boolean;
  coordinated?: boolean;
  env?: Readonly<Record<string, string>>;
  worktree?: boolean;
  modeRequests?: ModeRequests;
  approvals?: PermissionGate;
  askTitle?: boolean;
  session?: SessionTarget;
  preamble?: string;
  repo?: RepoLaunch;
  userMcp?: readonly UserMcpLaunch[];
  spark?: SparkSessionPrefs;
}

export type GateAnswer =
  | {
      outcome: 'selected';
      optionId: string;
      allowed: boolean;
      note: string;
      approvalId?: string;
    }
  | { outcome: 'cancelled'; note: string };

export interface PermissionGate {
  review(request: ApprovalRequest, signal: AbortSignal): Promise<GateAnswer>;
}

export interface ProtocolObserver {
  message(direction: ProtocolDirection, message: unknown): void;
  stderr(chunk: string): void;
}

export interface CapabilityChoice {
  id: string;
  label: string;
  description: string | null;
}

export interface ProviderCapabilityReport {
  models: CapabilityChoice[];
  efforts: CapabilityChoice[];
  defaultModel: string | null;
  modes?: AgentModeOption[];
  defaultMode?: string | null;
  options?: ConfigOptionInfo[];
}

export type UsageReadings = 'start_and_end' | 'end';

export type ProviderOutput =
  | {
      kind: 'step_started';
      name: string;
      tool?: boolean;
      toolKind?: string;
      target?: string;
    }
  | {
      kind: 'step_finished';
      name: string;
      tool?: boolean;
      toolKind?: string;
      target?: string;
    }
  | { kind: 'text_delta'; delta: string }
  | { kind: 'capabilities'; report: ProviderCapabilityReport }
  | {
      kind: 'usage';
      contextUsed: number;
      contextSize: number;
      costUsd: number | null;
      readings?: UsageReadings;
    }
  | { kind: 'tokens'; tokens: TokenUsage }
  | {
      kind: 'session_settings';
      model: string | null;
      effort: string | null;
      mode: string | null;
      options?: ConfigValues;
    }
  | { kind: 'plan'; entries: PlanEntry[] }
  | {
      kind: 'session';
      sessionId: string;
      cwd: string;
      additionalDirectories: string[];
      continued: boolean;
      freshReason: string | null;
    }
  | { kind: 'link'; url: string; title: string; source: Exclude<TaskLinkSource, 'user'> }
  | { kind: 'commands'; commands: AgentCommand[] }
  | { kind: 'instructions'; files: string[] };

export interface Provider {
  readonly name: string;
  run(turn: ProviderTurn): AsyncIterable<ProviderOutput>;
}

export class ProviderError extends Error {}
