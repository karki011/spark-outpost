import type { ApprovalFact } from '../tasks/types.ts';
import type { ReviewMarks } from '../rows/review-marks.ts';
import { fields, result, type CheckResult, type LogRow } from '../rows/types.ts';

const GATED_KINDS = new Set(['edit', 'execute']);
const SPARK_OWN_PREFIX = 'check:';

export interface AgentToolCall {
  runId: string;
  toolCallId: string;
  kind: string;
}

function callKey(call: { runId: string; toolCallId: string }): string {
  return `${call.runId} ${call.toolCallId}`;
}

export function gatedToolCalls(rows: readonly LogRow[]): AgentToolCall[] {
  const calls = new Map<string, AgentToolCall>();
  for (const row of rows) {
    if (row.direction !== 'from_agent' || row.method !== 'session/update') continue;
    const update = fields(fields(fields(row.payload).params).update);
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update')
      continue;
    if (typeof update.toolCallId !== 'string' || typeof update.kind !== 'string') continue;
    const call = { runId: row.runId, toolCallId: update.toolCallId, kind: update.kind };
    calls.set(callKey(call), call);
  }
  return [...calls.values()].filter((call) => GATED_KINDS.has(call.kind));
}

export function gateMatchCheck(
  calls: readonly AgentToolCall[],
  decisions: readonly ApprovalFact[],
  marks: ReviewMarks,
): CheckResult {
  const ranWithoutReview = marks.other.length;
  const toolDecisions = decisions.filter(
    (decision) =>
      GATED_KINDS.has(decision.kind) && !decision.toolCallId.startsWith(SPARK_OWN_PREFIX),
  );
  const decided = new Map<string, number>();
  for (const decision of toolDecisions) {
    decided.set(callKey(decision), (decided.get(callKey(decision)) ?? 0) + 1);
  }
  const callIds = new Set(calls.map(callKey));
  const unmatchedCalls = calls.filter((call) => !decided.has(callKey(call))).length;
  const repeated = [...decided.values()].filter((count) => count > 1).length;
  const strayDecisions = [...decided.keys()].filter((id) => !callIds.has(id)).length;
  const pass =
    unmatchedCalls === 0 && repeated === 0 && strayDecisions === 0 && ranWithoutReview === 0;
  const detail = `${calls.length} edit and command calls, ${toolDecisions.length} decisions; ${unmatchedCalls} calls with no decision, ${strayDecisions} decisions with no call, ${repeated} calls decided twice, ${ranWithoutReview} ran without review; ${marks.sparkTools} Spark tool calls marked`;
  return result('Every call seen by the gate', pass, detail, {
    calls: calls.length,
    decisions: toolDecisions.length,
    unmatchedCalls,
    strayDecisions,
    repeated,
    ranWithoutReview,
    sparkToolMarks: marks.sparkTools,
  });
}
