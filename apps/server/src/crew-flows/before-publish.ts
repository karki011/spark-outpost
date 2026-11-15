import {
  blockingFindings,
  workflowProblems,
  type WorkflowTriggers,
} from '@spark-outpost/contracts';
import type { Handoff } from '../orchestration/spark-child.ts';
import type { GateVerdict } from '../workflow/publish-step.ts';
import { newId } from '../persistence/ids.ts';
import { insertOrchestration, updateOrchestration } from '../persistence/orchestrations.ts';
import { publishOrchestration } from '../orchestration/spark-child.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { chatCode, diffHash } from './chat-code.ts';
import { clearHolds, holdPublish, lastGateHash, openHold } from './publish-holds.ts';
import { insertWorkflowRun, recordBlocking, workflowRunById } from './run-records.ts';
import { runWorkflow, type WorkflowEnd } from './run-workflow.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import { triggersWith } from './trigger-records.ts';
import { workflowStore, type WorkflowStore } from './workflow-store.ts';

export const GATE_MESSAGE =
  'Started by this workflow’s trigger before Spark publishes this chat’s branch. Review the branch as it is now.';

const GO: GateVerdict = { kind: 'go' };

interface Gate {
  h: Handoff;
  store: WorkflowStore;
  conversationId: string;
  hash: string | null;
}

export function heldLine(name: string, findings: number, finished: boolean): string {
  const why = finished
    ? `${name} found ${findings} Critical or High ${findings === 1 ? 'finding' : 'findings'}`
    : `${name} did not finish its review`;
  return `Not published: ${why}. Fix it and Spark reviews again before the next publish, release the hold on the workflow’s Triggers tab, or ask for the publish in a message.`;
}

function reviewLine(name: string, findings: number, finished: boolean): string {
  if (!finished) return `Before publishing, ${name} did not finish its review.`;
  if (findings === 0) return `Before publishing, ${name} found no Critical or High findings.`;
  return `Before publishing, ${name} found ${findings} Critical or High ${findings === 1 ? 'finding' : 'findings'}.`;
}

function countFindings(end: WorkflowEnd): number {
  return end.steps.reduce((sum, step) => sum + blockingFindings(step.note), 0);
}

interface GateEnd {
  id: string;
  name: string;
  end: WorkflowEnd;
}

async function runGate(gate: Gate, workflowId: string): Promise<GateEnd | 'stopped' | null> {
  const { h, conversationId } = gate;
  const { db } = h.deps;
  const file = await gate.store.read(workflowId);
  if (!file) return null;
  const [problem] = workflowProblems(
    file.workflow.steps,
    await workspaceSparkIds(db, h.input.workspaceId),
  );
  if (problem) {
    await planNote(h.append, `Workflow ${file.workflow.name} did not run: ${problem.text}`);
    return null;
  }
  await insertOrchestration(db, {
    runId: h.lease.runId,
    depth: 'direct',
    depthSource: 'user',
    risk: 'read-only',
  });
  const id = newId();
  await insertWorkflowRun(db, {
    id,
    workspaceId: h.input.workspaceId,
    workflow: file.workflow,
    kind: 'run',
    source: 'trigger',
    conversationId,
    runId: null,
    gatesRunId: h.lease.runId,
    message: GATE_MESSAGE,
    continues: true,
    triggerKind: 'before_publish',
    diffHash: gate.hash,
  });
  const turn = await workflowRunById(db, id);
  if (!turn) return null;
  const end = await runWorkflow(h, turn, { findings: true });
  if (end !== 'lease_lost') {
    await updateOrchestration(db, h.lease.runId, { phase: 'finished' });
    await publishOrchestration(h);
  }
  if (end === 'lease_lost' || end.status === 'cancelled' || h.control.signal.aborted) {
    return 'stopped';
  }
  await recordBlocking(db, id, countFindings(end));
  return { id, name: file.workflow.name, end };
}

async function gateOne(gate: Gate, workflowId: string, triggers: WorkflowTriggers) {
  const { h, conversationId, hash } = gate;
  const { db } = h.deps;
  if (hash !== null && hash === (await lastGateHash(db, workflowId, conversationId))) {
    const hold = await openHold(db, conversationId, workflowId);
    if (!hold || !triggers.holdOnFindings) return GO;
    const name = (await gate.store.read(workflowId))?.workflow.name ?? workflowId;
    return { kind: 'held', line: heldLine(name, hold.findings, hold.finished) } as const;
  }
  const ran = await runGate(gate, workflowId);
  if (ran === 'stopped') return { kind: 'stopped' } as const;
  if (ran === null) return GO;
  const { id, name, end } = ran;
  const findings = countFindings(end);
  const finished = end.status === 'succeeded';
  await planNote(h.append, reviewLine(name, findings, finished));
  if (!triggers.holdOnFindings || (finished && findings === 0)) {
    await clearHolds(db, conversationId, workflowId);
    return GO;
  }
  await holdPublish(db, {
    workspaceId: h.input.workspaceId,
    conversationId,
    workflowId,
    workflowRunId: id,
    diffHash: hash ?? '',
    findings,
    finished,
  });
  return { kind: 'held', line: heldLine(name, findings, finished) } as const;
}

export async function gateBeforePublish(
  h: Handoff,
  store: WorkflowStore = workflowStore(),
): Promise<GateVerdict> {
  const conversationId = h.input.identity.threadId;
  const { db } = h.deps;
  const gates = await triggersWith(db, h.input.workspaceId, 'before_publish', conversationId);
  if (gates.length === 0) return GO;
  const code = await chatCode(db, conversationId);
  const gate: Gate = { h, store, conversationId, hash: code ? await diffHash(code) : null };
  for (const { workflowId, triggers } of gates) {
    const verdict = await gateOne(gate, workflowId, triggers);
    if (verdict.kind !== 'go') return verdict;
  }
  return GO;
}
