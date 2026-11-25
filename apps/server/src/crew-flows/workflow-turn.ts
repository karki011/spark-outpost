import { findSparkMentions } from '@spark-outpost/contracts';
import { hasProject, publishOrchestration, type Handoff } from '../orchestration/spark-child.ts';
import { typedOnTheMac } from '../orchestration/typed-on-mac.ts';
import { userText } from '../sub-chats/user-asked.ts';
import { addToQueue } from '../persistence/chat-queue.ts';
import { withTransaction } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { insertOrchestration, updateOrchestration } from '../persistence/orchestrations.ts';
import { reviewOptions, settleReviewOfWorkflowRun } from '../github-inbox/review/settle.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { runEvents } from '../workflow/run-events.ts';
import { keepChatFiles } from '../workflow/chat-folder.ts';
import { chatTarget, drainQueue } from '../workflow/queue-drain.ts';
import type { RunInput } from '../workflow/run-input.ts';
import {
  insertWorkflowRun,
  recordReport,
  reportNoteOfTurn,
  workflowRunForTurn,
  type TurnWorkflowRun,
} from './run-records.ts';
import { runWorkflow, type WorkflowEnd } from './run-workflow.ts';
import { runnableWorkflow } from './runnable.ts';
import {
  checkoutChanges,
  checkoutNote,
  placeRunPull,
  removeRunCheckout,
  type PullPlace,
} from './pr-checkout.ts';
import { pullBlockedLine, pullBlocksRun, readRunPull } from './pull-material.ts';
import { finishWorkflowRun, settleStep } from './run-records.ts';
import { keepStepEdits, prepareStepEdits } from './step-edits.ts';
import { runPull } from './step-place-gather.ts';
import { runPullLine } from './step-place.ts';
import {
  WORKFLOW_REPORT_MESSAGE,
  backgroundReport,
  laneLine,
  workflowNote,
  type WorkflowNote,
} from './step-prompt.ts';
import { getTriggers } from './trigger-records.ts';
import { workspaceSparkIds } from './step-sparks.ts';
import { workflowStore } from './workflow-store.ts';

export const WORKFLOW_MAC_ONLY = 'Workflows start on the Mac, so this one did not start.';
export const WORKFLOW_STOPPED = 'The workflow stopped because a step failed.';

async function startByMention(h: Handoff): Promise<TurnWorkflowRun | null> {
  const { deps, input, lease } = h;
  const text = input.followUpRound ? '' : userText(input);
  if (!text.includes('@')) return null;
  const store = workflowStore();
  const names = (await store.ids()).map((name) => ({ name }));
  const [mention] = findSparkMentions(text, names);
  if (!mention) return null;
  const typed = await typedOnTheMac(deps.db, lease.runId);
  if (typed === 'no') return null;
  if (typed === 'device') {
    await planNote(h.append, WORKFLOW_MAC_ONLY);
    return null;
  }
  const file = await store.read(mention.spark.name);
  if (!file) return null;
  const sparkIds = await workspaceSparkIds(deps.db, input.workspaceId);
  const { workflow, problems } = await runnableWorkflow(store, file.workflow, sparkIds);
  if (!workflow) {
    await planNote(h.append, `Workflow ${file.workflow.name} did not start: ${problems[0].text}`);
    return null;
  }
  await insertWorkflowRun(deps.db, {
    id: newId(),
    workspaceId: input.workspaceId,
    workflow,
    kind: 'run',
    source: 'mention',
    conversationId: input.identity.threadId,
    runId: lease.runId,
    message: `${text.slice(0, mention.start)}${text.slice(mention.end)}`.trim(),
    continues: true,
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

type Placed =
  { end: WorkflowEnd | 'lease_lost'; checkout: string | null } | { end: 'blocked'; line: string };

async function runOnPlace(
  h: Handoff,
  turn: TurnWorkflowRun,
  options: Parameters<typeof runWorkflow>[2],
): Promise<Placed> {
  const pull = await pullPlaceOf(h, turn);
  const read = await readRunPull(h, turn, pull);
  if (h.control.reason() === 'lease_lost') return { end: 'lease_lost', checkout: null };
  const stopped = h.control.signal.aborted;
  if (!stopped && pullBlocksRun(h, read) && pull.kind === 'unlinked') {
    return { end: 'blocked', line: pullBlockedLine(turn.workflow.name, pull.pull, read.reason) };
  }
  const pullMaterial = read.kind === 'read' ? read.material : null;
  let end: WorkflowEnd | 'lease_lost';
  try {
    end = await runWorkflow(h, turn, { ...options, pull, pullMaterial });
  } catch (error) {
    if (pull.kind === 'checkout') await removeRunCheckout(h.deps.db, turn.run.id);
    throw error;
  }
  if (end === 'lease_lost') return { end, checkout: null };
  const changed = pull.kind === 'checkout' ? await checkoutChanges(pull.path) : [];
  if (pull.kind === 'checkout') await removeRunCheckout(h.deps.db, turn.run.id);
  return { end, checkout: checkoutNote(pull, changed, pullMaterial !== null) };
}

async function stopUnstarted(h: Handoff, turn: TurnWorkflowRun, line: string): Promise<void> {
  const { db } = h.deps;
  for (const step of turn.run.steps)
    await settleStep(db, turn.run.id, step.stepId, 'skipped', line);
  await finishWorkflowRun(db, turn.run.id, 'failed', null);
  await updateOrchestration(db, h.lease.runId, { phase: 'finished' });
  await publishOrchestration(h);
  await h.append(runEvents.error(line, 'orchestration_failed'), {
    transition: { status: 'failed', error: line },
  });
}

async function quietWhenClean(h: Handoff, workflowId: string): Promise<boolean> {
  if (!h.input.workflowLane) return false;
  const stored = await getTriggers(h.deps.db, h.input.workspaceId, workflowId);
  return stored?.triggers.quietWhenClean === true;
}

async function queueReport(h: Handoff, turn: TurnWorkflowRun, note: string): Promise<boolean> {
  const chatId = h.input.identity.threadId;
  const messageId = newId();
  try {
    return await withTransaction(h.deps.db, async (client) => {
      if (!(await recordReport(client, turn.run.id, { messageId, note }))) return false;
      const content = WORKFLOW_REPORT_MESSAGE(turn.workflow.name);
      await addToQueue(client, chatId, { id: messageId, content, origin: 'workflow' });
      return true;
    });
  } catch (error) {
    console.error('A workflow report could not be queued for its chat', error);
    return false;
  }
}

async function finishLane(
  h: Handoff,
  turn: TurnWorkflowRun,
  end: WorkflowEnd,
  facts: Pick<WorkflowNote, 'about' | 'checkout'>,
  quiet: boolean,
): Promise<void> {
  const note = turn.continues
    ? backgroundReport(
        { ...end, ...facts, workflowName: turn.workflow.name, continues: true },
        quiet,
      )
    : null;
  const sent = note !== null && (await queueReport(h, turn, note));
  const clean = quiet && note === null && end.status === 'succeeded';
  const line = laneLine(turn.workflow.name, end.status, sent ? 'sent' : clean ? 'clean' : 'none');
  await finishTurn(h, end, line);
  if (!sent) return;
  const chatId = h.input.identity.threadId;
  await drainQueue(h.deps.db, chatId, chatTarget(h.deps.db)).catch((error: unknown) =>
    console.error('A workflow report waits in its chat’s queue', error),
  );
}

export async function withWorkflowReport(h: Handoff): Promise<RunInput> {
  if (!h.input.workflowStarted || h.input.workflowLane) return h.input;
  const report = await reportNoteOfTurn(h.deps.db, h.lease.runId);
  return report === null ? h.input : { ...h.input, prompt: `${h.input.prompt}\n\n${report}` };
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
  const quiet = await quietWhenClean(h, turn.workflow.id);
  const placed = await runOnPlace(h, prepared, {
    ...(review === undefined ? {} : { review }),
    ...(quiet ? { findings: true } : {}),
  });
  if (placed.end === 'blocked') {
    await stopUnstarted(h, turn, placed.line);
    return 'finished';
  }
  const { end, checkout } = placed;
  if (end === 'lease_lost') return 'finished';
  if (review !== undefined) await settleReviewOfWorkflowRun(deps.db, turn.run.id);
  await keepStepEdits(h, prepared);
  const continues = !input.workflowLane && turn.continues && end.status !== 'cancelled';
  const target = await runPull(deps.db, turn).catch(() => null);
  const about = target ? runPullLine(target) : null;
  if (input.workflowLane) {
    await updateOrchestration(deps.db, lease.runId, { phase: 'finished' });
    await publishOrchestration(h);
    await keepChatFiles(deps.db, deps.chatFolders, input, lease);
    await finishLane(h, turn, end, { about, checkout }, quiet);
    return 'finished';
  }
  const note = workflowNote({
    ...end,
    workflowName: turn.workflow.name,
    continues,
    fromUser: turn.run.source === 'mention',
    about,
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
