import type { Db } from '../../../apps/server/src/persistence/db.ts';
import type { CommandTiming, OutputEvent } from '../rows/types.ts';
import type { AuditFacts } from '../tasks/types.ts';
import type { AgentUsage } from './usage.ts';

export const REPLY_LIMIT = 4_000;
export const TITLE_LIMIT = 300;

export interface AgentShare {
  provider: string;
  model: string | null;
  tokens: { input: number; cached: number; output: number };
  costUsd: number;
  costSource: string | null;
  toolCalls: number;
  durationMs: number;
}

export interface TracedCall {
  kind: string;
  title: string;
  status: string | null;
  unreviewed: boolean;
}

export interface TracedApproval {
  kind: string;
  title: string;
  status: string;
  decidedBy: string | null;
  why: string | null;
}

export interface TracedCommand {
  command: string;
  ranMs: number | null;
  exitCode: number | null;
  status: string;
  outputEvents: number;
  firstOutputMs: number | null;
}

export interface RunTrace {
  reply: string;
  agents: AgentShare[];
  calls: TracedCall[];
  approvals: TracedApproval[];
  commands: TracedCommand[];
  railFlags: string[];
}

export interface TraceInput {
  reply: string;
  agents: readonly AgentUsage[];
  audit: AuditFacts;
  reasons: ReadonlyMap<string, string | null>;
  commands: readonly CommandTiming[];
  outputs: readonly OutputEvent[];
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)} [${text.length - limit} more]` : text;
}

function commandOf(command: CommandTiming, input: TraceInput): TracedCommand {
  const times = input.outputs
    .filter((event) => event.commandId === command.id)
    .map((event) => event.at)
    .sort((a, b) => a - b);
  return {
    command: clip(command.command, TITLE_LIMIT),
    ranMs: command.finishedAt === null ? null : command.finishedAt - command.startedAt,
    exitCode: command.exitCode,
    status: command.status,
    outputEvents: times.length,
    firstOutputMs: times.length > 0 ? times[0]! - command.startedAt : null,
  };
}

export function traceOf(input: TraceInput): RunTrace {
  return {
    reply: clip(input.reply, REPLY_LIMIT),
    agents: input.agents.map((agent) => ({
      provider: agent.provider,
      model: agent.model,
      tokens: {
        input: agent.inputTokens,
        cached: agent.cachedReadTokens,
        output: agent.outputTokens,
      },
      costUsd: agent.costUsd,
      costSource: agent.costSource,
      toolCalls: agent.toolCalls,
      durationMs: agent.durationMs,
    })),
    calls: (input.audit.calls ?? []).map((call) => ({
      kind: call.kind,
      title: clip(call.title, TITLE_LIMIT),
      status: call.status,
      unreviewed: call.unreviewed,
    })),
    approvals: input.audit.approvals.map((approval) => ({
      kind: approval.kind,
      title: clip(approval.title, TITLE_LIMIT),
      status: approval.status,
      decidedBy: approval.decidedBy,
      why: input.reasons.get(`${approval.runId} ${approval.toolCallId}`) ?? null,
    })),
    commands: input.commands.map((command) => commandOf(command, input)),
    railFlags: [...input.audit.railFlags],
  };
}

export async function approvalReasons(
  db: Db,
  runIds: string[],
): Promise<Map<string, string | null>> {
  const { rows } = await db.query<{ run_id: string; tool_call_id: string; why: string | null }>(
    `SELECT run_id, tool_call_id,
       COALESCE(reason, payload->>'asksBecause', payload->>'agentReason') AS why
     FROM approvals WHERE run_id = ANY($1) ORDER BY created_at`,
    [runIds],
  );
  return new Map(rows.map((row) => [`${row.run_id} ${row.tool_call_id}`, row.why]));
}
