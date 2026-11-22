import { findSparkMentions, mainAgentContinues, workflowProblems } from '@spark-outpost/contracts';
import { hasProject, publishOrchestration, type Handoff } from '../orchestration/spark-child.ts';
import { userText } from '../sub-chats/user-asked.ts';
import { newId } from '../persistence/ids.ts';
import { insertOrchestration, updateOrchestration } from '../persistence/orchestrations.ts';
import { reviewOptions, settleReviewOfWorkflowRun } from '../github-inbox/review/settle.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { insertWorkflowRun, workflowRunForTurn, type TurnWorkflowRun } from './run-records.ts';
import { runWorkflow, type WorkflowEnd } from './run-workflow.ts';
import {
  checkoutChanges,
  checkoutNote,
  placeRunPull,
  removeRunCheckout,
  type PullPlace,
} from './pr-checkout.ts';
import { keepStepEdits, prepareStepEdits } from './step-edits.ts';
import { runPull } from './step-place-gather.ts';
import { runPullLine } from './step-place.ts';
import { workflowNote } from './step-prompt.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import { workflowStore } from './workflow-store.ts';

export const WORKFLOW_MAC_ONLY = 'Workflows start on the Mac, so this one did not start.';
export const WORKFLOW_STOPPED = 'The workflow stopped because a step failed.';

const TYPED_SOURCES: ReadonlySet<string | null> = new Set([null, 'ui', 'e2e', 'bench', 'queue']);

async function typedOnTheMac(h: Handoff): Promise<'yes' | 'device' | 'no'> {
  const { rows } = await h.deps.db.query<{ source: string | null; device: string | null }>(
    'SELECT source, remote_device_id AS device FROM runs WHERE id = $1',
    [h.lease.runId],
  );
  const run = rows[0];
  if (!run || !TYPED_SOURCES.has(run.source)) return 'no';
  return run.device === null ? 'yes' : 'device';
}

async function startByMention(h: Handoff): Promise<TurnWorkflowRun | null> {
  const { deps, input, lease } = h;
  const text = input.followUpRound ? '' : userText(input);
  if (!text.includes('@')) return null;
  const store = workflowStore();
  const names = (await store.ids()).map((name) => ({ name }));
  const [mention] = findSparkMentions(text, names);
  if (!mention) return null;
  const typed = await typedOnTheMac(h);
  if (typed === 'no') return null;
  if (typed === 'device') {
    await planNote(h.append, WORKFLOW_MAC_ONLY);
    return null;
  }
  const file = await store.read(mention.spark.name);
  if (!file) return null;
  const sparkIds = await workspaceSparkIds(deps.db, input.workspaceId);
  const [problem] = workflowProblems(file.workflow.steps, sparkIds);
  if (problem) {
    await planNote(h.append, `Workflow ${file.workflow.name} did not start: ${problem.text}`);
    return null;
  }
  await insertWorkflowRun(deps.db, {
    id: newId(),
    workspaceId: input.workspaceId,
    workflow: file.workflow,
    kind: 'run',
    source: 'mention',
    conversationId: input.identity.threadId,
    runId: lease.runId,
    message: `${text.slice(0, mention.start)}${text.slice(mention.end)}`.trim(),
    continues: mainAgentContinues(text, [mention]),
  });
  return workflowRunForTurn(deps.db, lease.runId);
}

async function finishTurn(h: Handoff, end: WorkflowEnd, note: string): Promise<void> {
  const identity = h.input.identity;
  if (end.status === 'cancelled') {
    await h.append(runEvents.cancelled(identity), { transition: { status: 'cancelled' } });
    return;
  }
  const messageId = newId();
  await h.append(runEvents.textStart(messageId));
  await h.append(runEvents.textContent(messageId, note));
  await closeMessage(h.append, { messageId, text: note }, true);
  if (end.status === 'succeeded') {
    await h.append(runEvents.finished(identity), { transition: { status: 'succeeded' } });
    return;
  }
  await h.append(runEvents.error(WORKFLOW_STOPPED, 'orchestration_failed'), {
    transition: { status: 'failed', error: WORKFLOW_STOPPED },
  });
}

async function pullPlaceOf(h: Handoff, turn: TurnWorkflowRun): Promise<PullPlace> {
  if (turn.run.kind !== 'run' || !turn.run.pull) return { kind: 'none' };
  return placeRunPull({
    db: h.deps.db,
    workspaceId: h.input.workspaceId,
    workflowRunId: turn.run.id,
    pullId: turn.run.pull,
    roots: hasProject(h.input) ? h.input.projectRoots : [],
  });
}

async function runOnPlace(
  h: Handoff,
  turn: TurnWorkflowRun,
  options: Parameters<typeof runWorkflow>[2],
): Promise<{ end: WorkflowEnd | 'lease_lost'; checkout: string | null }> {
  const pull = await pullPlaceOf(h, turn);
  let end: WorkflowEnd | 'lease_lost';
  try {
    end = await runWorkflow(h, turn, { ...options, pull });
  } catch (error) {
    if (pull.kind === 'checkout') await removeRunCheckout(h.deps.db, turn.run.id);
    throw error;
  }
  if (end === 'lease_lost') return { end, checkout: null };
  const changed = pull.kind === 'checkout' ? await checkoutChanges(pull.path) : [];
  if (pull.kind === 'checkout') await removeRunCheckout(h.deps.db, turn.run.id);
  return { end, checkout: checkoutNote(pull, changed) };
}

export async function workflowTurn(
  h: Handoff,
  sparkMentioned: boolean,
): Promise<RunInput | 'finished' | null> {
  const { deps, input, lease } = h;
  const started = await workflowRunForTurn(deps.db, lease.runId);
  const turn = started ?? (sparkMentioned ? null : await startByMention(h));
  if (!turn) return null;
  await insertOrchestration(deps.db, {
    runId: lease.runId,
    depth: 'direct',
    depthSource: 'user',
    risk: 'read-only',
  });
  await updateOrchestration(deps.db, lease.runId, { phase: 'scouting' });
  const prepared = await prepareStepEdits(h, turn);
  const review =
    turn.run.kind === 'review'
      ? await reviewOptions(deps.db, input.workspaceId, turn.run.id)
      : undefined;
  const { end, checkout } = await runOnPlace(h, prepared, review === undefined ? {} : { review });
  if (end === 'lease_lost') return 'finished';
  if (review !== undefined) await settleReviewOfWorkflowRun(deps.db, turn.run.id);
  await keepStepEdits(h, prepared);
  const continues = turn.continues && end.status !== 'cancelled';
  const target = await runPull(deps.db, turn).catch(() => null);
  const note = workflowNote({
    ...end,
    workflowName: turn.workflow.name,
    continues,
    about: target ? runPullLine(target) : null,
    checkout,
  });
  if (!continues) {
    await updateOrchestration(deps.db, lease.runId, { phase: 'finished' });
    await publishOrchestration(h);
    await finishTurn(h, end, note);
    return 'finished';
  }
  await publishOrchestration(h);
  return { ...input, prompt: `${input.prompt}\n\n${note}` };
}
