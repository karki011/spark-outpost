import {
  findSparkMentions,
  mainAgentContinues,
  sparkWho,
  withoutShadowed,
} from '@spark-outpost/contracts';
import { workflowTurn } from '../crew-flows/workflow-turn.ts';
import { workflowStore } from '../crew-flows/workflow-store.ts';
import { chatTickets } from '../persistence/chat-tickets.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { insertOrchestration, updateOrchestration } from '../persistence/orchestrations.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { mentionableSparks, type MentionableSpark } from '../persistence/spark-mentions.ts';
import { taskOverviews } from '../persistence/task-views.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import {
  hasProject,
  pickFor,
  publishOrchestration,
  runSparkChild,
  type Handoff,
} from './spark-child.ts';
import { handoffNote, sparkJobPrompt, type SparkResult } from './spark-job.ts';

export const ALL_SPARKS_FAILED = 'The Spark could not finish this job.';

async function jobContext(db: Db, input: RunInput) {
  const conversationId = input.identity.threadId;
  const [tasks, tickets] = await Promise.all([
    taskOverviews(db, conversationId).catch(() => []),
    chatTickets(db, conversationId).catch(() => ({ linked: [] })),
  ]);
  return {
    task: tasks.findLast((task) => task.closedAt === null) ?? null,
    tickets: tickets.linked,
    lastReply: input.history.findLast((turn) => turn.role === 'assistant')?.content ?? null,
    hasProject: hasProject(input),
  };
}

async function runSpark(
  h: Handoff,
  spark: MentionableSpark,
  index: number,
  prompt: string,
  only: boolean,
): Promise<SparkResult> {
  const result = await runSparkChild(h, {
    role: 'spark',
    stepIndex: index,
    attempt: 1,
    agentLabel: sparkWho(spark),
    ...pickFor(h, spark),
    mode: hasProject(h.input) ? 'ask' : 'chat',
    prompt,
    route: {
      name: spark.name,
      routedBy: 'fixed',
      spark: { id: spark.id, role: spark.role, only },
    },
  });
  return { spark, outcome: result.outcome, text: result.text, error: result.error };
}

async function noticeCancelSeenBySpark(h: Handoff): Promise<void> {
  if (h.control.signal.aborted) return;
  if (await isCancelRequested(h.deps.db, h.lease.runId)) h.control.stop('cancelled');
}

async function finishWithNote(h: Handoff, results: readonly SparkResult[], note: string) {
  const identity = h.input.identity;
  await updateOrchestration(h.deps.db, h.lease.runId, { phase: 'finished' });
  await publishOrchestration(h);
  if (h.control.reason() === 'cancelled') {
    await h.append(runEvents.cancelled(identity), { transition: { status: 'cancelled' } });
    return;
  }
  const messageId = newId();
  await h.append(runEvents.textStart(messageId));
  await h.append(runEvents.textContent(messageId, note));
  await closeMessage(h.append, { messageId, text: note }, true);
  if (results.some((result) => result.outcome === 'succeeded')) {
    await h.append(runEvents.finished(identity), { transition: { status: 'succeeded' } });
    return;
  }
  const error = results.find((result) => result.error)?.error ?? ALL_SPARKS_FAILED;
  await h.append(runEvents.error(error, 'orchestration_failed'), {
    transition: { status: 'failed', error },
  });
}

export async function handToSparks(h: Handoff): Promise<RunInput | 'finished'> {
  const { deps, input, lease } = h;
  if (input.parentRunId || input.assistant || !input.userRequest.includes('@')) return input;
  const sparks = await mentionableSparks(deps.db, input.identity.threadId);
  const workflowIds = (await workflowStore().ids()).map((name) => ({ name }));
  const mentions = withoutShadowed(
    findSparkMentions(input.userRequest, sparks),
    findSparkMentions(input.userRequest, workflowIds),
  );
  const workflow = await workflowTurn(h, mentions.length > 0);
  if (workflow !== null) return workflow;
  if (mentions.length === 0) return input;
  const continues = mainAgentContinues(input.userRequest, mentions);
  await insertOrchestration(deps.db, {
    runId: lease.runId,
    depth: 'direct',
    depthSource: 'user',
    risk: 'read-only',
  });
  await updateOrchestration(deps.db, lease.runId, { phase: 'scouting' });
  const context = await jobContext(deps.db, input);
  const results: SparkResult[] = [];
  for (const [index, { spark }] of mentions.entries()) {
    if (h.control.signal.aborted) break;
    const prompt = sparkJobPrompt({ spark, request: input.userRequest, ...context });
    const result = await runSpark(h, spark, index, prompt, !continues);
    if (result.outcome === 'lease_lost') return 'finished';
    results.push(result);
  }
  if (h.control.reason() === 'lease_lost') return 'finished';
  await noticeCancelSeenBySpark(h);
  const note = handoffNote(results, continues);
  if (!continues || h.control.signal.aborted) {
    await finishWithNote(h, results, note);
    return 'finished';
  }
  await publishOrchestration(h);
  return {
    ...input,
    prompt: `${input.prompt}\n\n${note}`,
    userRequest: `${input.userRequest}\n\n${note}`,
  };
}
