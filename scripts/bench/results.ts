import type { BenchTaskId } from './tasks.ts';
import type { Verification } from './verify.ts';

export type BenchMode = 'direct' | 'harness';

export const BENCH_MODES: readonly BenchMode[] = ['direct', 'harness'];

export interface AgentUsage {
  role: string;
  name: string | null;
  provider: string;
  model: string | null;
  effort: string | null;
  status: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  costUsd: number;
  costSource: string | null;
  durationMs: number;
  toolCalls: number;
  parallelGroup: string | null;
}

export interface AskedItem {
  kind: string;
  title: string;
  answer: string;
  autoDenied: boolean;
}

export interface RoutingDecision {
  kind: string;
  role: string | null;
  summary: string;
  applied: string;
  confidence: number | null;
  jevStatus: string;
  costUsd: number | null;
}

export interface PickRecord {
  model: string | null;
  effort: string | null;
}

export interface IntakeRecord {
  scope: string | null;
  scopeConfidence: number | null;
  complexity: number | null;
  complexityConfidence: number | null;
  depthNote: string | null;
}

export interface ArchitectRecord {
  pick: PickRecord;
  routedBy: string;
  rule: string | null;
  rulePick: PickRecord | null;
  jevPick: PickRecord | null;
  gate: string | null;
  confidence: number | null;
}

export interface ParallelRecord {
  chosen: number[][];
  rulesGroups: number[][];
  asked: number;
  agreed: number;
  applied: string;
  jevStatus: string;
  steps?: { text: string; changes: string[]; reads: string[] }[];
  pairs?: { steps: number[]; rules: boolean; noul: number | null; independent: boolean }[];
  sizes?: { step: number; rules: boolean; noul: number | null; large: boolean }[];
}

export interface Routing {
  depth: string;
  depthSource: string;
  risk: string;
  decisions: RoutingDecision[];
  intake?: IntakeRecord | null;
  architect?: ArchitectRecord | null;
  parallel?: ParallelRecord | null;
}

export interface CellResult {
  task: BenchTaskId;
  mode: BenchMode;
  repeat: number;
  runId: string;
  status: string;
  error: string | null;
  startedAt: string;
  wallMs: number;
  activeMs: number;
  agents: AgentUsage[];
  toolCalls: number;
  retries: number;
  agentCostUsd: number;
  jevCostUsd: number;
  jevCalls: number;
  costUsd: number;
  asked: AskedItem[];
  verification: Verification;
  routing: Routing | null;
}

export interface BenchRun {
  version: 1;
  date: string;
  budgetUsd: number;
  spentUsd: number;
  stoppedForBudget: boolean;
  settings: {
    direct: string;
    harness: string;
    level: string;
    fixture: string;
  };
  results: CellResult[];
}
