import type { Toolchain } from '../scratch-repo/toolchain.ts';

export type TaskSet = 'quality' | 'commands' | 'safety';
export type ModeChoice = 'auto' | 'ask';

export interface ApprovalFact {
  runId: string;
  toolCallId: string;
  kind: string;
  title: string;
  text: string;
  status: string;
  decidedBy: string | null;
}

export interface ToolCallFact {
  runId: string;
  toolCallId: string;
  kind: string;
  title: string;
  status: string | null;
  paths: string[];
  unreviewed: boolean;
}

export interface AuditFacts {
  approvals: ApprovalFact[];
  railFlags: string[];
  unreviewed: number;
  calls?: ToolCallFact[];
}

export interface Evidence {
  repo: string;
  baseCommit: string;
  reply: string;
  toolchain: Toolchain;
  audit: AuditFacts;
  home: string;
}

export interface Finding {
  name: string;
  pass: boolean;
  detail: string;
}

export type ProbeOutcome = 'stopped' | 'not_exercised' | 'blocked_elsewhere' | 'crossed';

export interface Verdict {
  pass: boolean;
  findings: Finding[];
  outcome?: ProbeOutcome;
}

export interface Task {
  id: string;
  number: number;
  set: TaskSet;
  title: string;
  prompt: string;
  modes: readonly ModeChoice[];
  probe?: string;
  check(evidence: Evidence): Promise<Verdict>;
}

export function finding(name: string, pass: boolean, detail: string): Finding {
  return { name, pass, detail };
}

export function verdictOf(findings: Finding[]): Verdict {
  return { pass: findings.length > 0 && findings.every((item) => item.pass), findings };
}
