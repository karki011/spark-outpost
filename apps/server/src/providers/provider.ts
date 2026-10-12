import type {
  AgentCommand,
  AgentModeOption,
  ConfigOptionInfo,
  ConfigValues,
  FileFocus,
  PlanDocumentSource,
  PlanEntry,
  ProviderAccount,
  ProtocolDirection,
  RunMode,
  SparkSessionPrefs,
  TaskLinkSource,
  TokenUsage,
} from '@spark-outpost/contracts';
import type { RepoLaunch } from '../agent-config/launch.ts';
import type { UserMcpLaunch } from '../mcp/launch.ts';
import type { SparkScope } from '../spark-mcp/deps.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import type { ObservedRail } from '../agents/acp/rail-watch.ts';

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
  avoidModels?: readonly string[];
}

export interface ModeRequests {
  subscribe(listener: (mode: string) => void): () => void;
}

export interface SteerRequests {
  attach(send: (text: string) => Promise<boolean>): () => void;
}

export interface TurnInbox {
  take(): Promise<string | null>;
}

export interface StoredSession {
  sessionId: string;
  cwd: string;
  additionalDirectories: readonly string[];
  commands?: readonly string[];
  anyFolder?: boolean;
}

export interface MissedMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionTarget {
  workdir: string | null;
  resume: StoredSession | null;
  freshReason: string | null;
  followUp?: string;
  interrupted?: boolean;
  handoff?: string;
  missed?: readonly MissedMessage[];
}

export interface ProviderTurn {
  prompt: string;
  attachments?: readonly TurnAttachment[];
  history: ConversationTurn[];
  settings: AgentSettings;
  projectRoots?: readonly string[];
  signal: AbortSignal;
  observe?: (output: ProviderOutput) => void;
  audit?: ProtocolObserver;
  mode?: RunMode;
  changesProject?: boolean;
  publishes?: boolean;
  planning?: boolean;
  plansFirst?: boolean;
  modeRequests?: ModeRequests;
  steering?: SteerRequests;
  inbox?: TurnInbox;
  approvals?: PermissionGate;
  askTitle?: boolean;
  session?: SessionTarget;
  preamble?: string;
  turnPreamble?: string;
  repo?: RepoLaunch;
  userMcp?: readonly UserMcpLaunch[];
  spark?: SparkSessionPrefs;
  sparkScope?: SparkScope;
}

export type MessagePhase = 'commentary' | 'final';

export type GateAnswer =
  | {
      outcome: 'selected';
      optionId: string;
      allowed: boolean;
      note: string;
      approvalId?: string;
      denial?: string;
    }
  | { outcome: 'cancelled'; note: string };

export interface PermissionGate {
  review(request: ApprovalRequest, signal: AbortSignal): Promise<GateAnswer>;
}

export interface AuditMarks {
  unreviewed?: boolean;
}

export interface ProtocolObserver {
  message(direction: ProtocolDirection, message: unknown, marks?: AuditMarks): void;
  stderr(chunk: string): void;
}

export interface CapabilityChoice {
  id: string;
  label: string;
  description: string | null;
}

export interface ReportedModelAccess {
  reported: boolean;
  unlisted: string[];
  account?: ProviderAccount | null;
}

export interface ProviderCapabilityReport {
  access?: ReportedModelAccess;
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
      subagent?: string;
      waits?: boolean;
    }
  | {
      kind: 'step_finished';
      name: string;
      tool?: boolean;
      toolKind?: string;
      target?: string;
      subagent?: string;
      waits?: boolean;
    }
  | ({ kind: 'file_focus' } & FileFocus)
  | { kind: 'text_delta'; delta: string; phase?: MessagePhase; newMessage?: boolean }
  | { kind: 'thought_delta'; delta: string }
  | { kind: 'tool_started'; id: string; name: string; subagent?: string }
  | { kind: 'subagent_started'; id: string; parentId: string | null; name: string; task: string }
  | { kind: 'subagent_finished'; id: string; state: 'done' | 'failed' | 'cancelled' }
  | { kind: 'tool_input'; id: string; input: unknown; secret: boolean }
  | { kind: 'tool_result'; id: string; output: unknown; secret: boolean }
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
  | { kind: 'plan_proposed'; plan: string; toolCallId: string; source: PlanDocumentSource }
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
  | { kind: 'instructions'; files: string[] }
  | { kind: 'rail_flag'; flag: ObservedRail }
  | { kind: 'secret_read'; paths: string[] }
  | { kind: 'command_started'; id: string; command: string; cwd: string | null; live: boolean }
  | { kind: 'command_output'; id: string; data: string; replace?: boolean }
  | { kind: 'command_finished'; id: string; failed: boolean; exitCode: number | null }
  | { kind: 'account'; account: ProviderAccount };

export interface Provider {
  readonly name: string;
  run(turn: ProviderTurn): AsyncIterable<ProviderOutput>;
}

export class ProviderError extends Error {
  readonly details: string | null;

  constructor(message: string, details: string | null = null) {
    super(message);
    this.details = details;
  }
}

export class ModelRejectedError extends ProviderError {
  readonly model: string | null;

  constructor(agentName: string, model: string | null, details: string | null) {
    super(
      `${agentName} can't use this model with your sign-in. Pick another model in Settings > Models.`,
      details,
    );
    this.model = model;
  }
}
