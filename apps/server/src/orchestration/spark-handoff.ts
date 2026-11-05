import {
  ORCHESTRATION_ACTIVITY,
  findSparkMentions,
  mainAgentContinues,
  sparkWho,
} from '@spark-outpost/contracts';
import { chatTickets } from '../persistence/chat-tickets.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  insertChildRun,
  insertOrchestration,
  loadOrchestration,
  updateOrchestration,
} from '../persistence/orchestrations.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { requestCancel } from '../persistence/runs.ts';
import { mentionableSparks, type MentionableSpark } from '../persistence/spark-mentions.ts';
import { taskOverviews } from '../persistence/task-views.ts';
import type { Append, RunControl } from '../workflow/agent-turn.ts';
import { closeMessage, executeChildRun } from '../workflow/execute-run.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { ChatTurnDeps } from '../workflow/chat-turn-hooks.ts';
import { handoffNote, sparkJobPrompt, type SparkResult } from './spark-job.ts';

export const ALL_SPARKS_FAILED = 'The Spark could not finish this job.';

interface Handoff {
  deps: ChatTurnDeps;
  lease: Lease;
  input: RunInput;
  append: Append;
  control: RunControl;
}

async function publish(h: Handoff): Promise<void> {
  const view = await loadOrchestration(h.deps.db, h.lease.runId);
  if (view)
    await h.append(runEvents.activity(ORCHESTRATION_ACTIVITY, ORCHESTRATION_ACTIVITY, view));
}

function pickFor(h: Handoff, spark: MentionableSpark) {
  const { input } = h;
  const own = spark.provider !== null && spark.connected && h.deps.providers.has(spark.provider);
  if (!own || spark.provider === input.provider) {
    return {
      provider: input.provider,
      model: (spark.provider === input.provider ? spark.model : null) ?? input.settings.model,
      effort: input.settings.effort,
    };
  }
  return { provider: spark.provider!, model: spark.model, effort: null };
}

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
    hasProject: input.projectRoots.length > 0 && !input.chatFolder,
  };
}

async function runSpark(
  h: Handoff,
  spark: MentionableSpark,
  index: number,
  prompt: string,
  only: boolean,
): Promise<SparkResult> {
  const pick = pickFor(h, spark);
  const lease = await insertChildRun(
    h.deps.db,
    {
      parentRunId: h.lease.runId,
      role: 'spark',
      stepIndex: index,
      attempt: 1,
      agentLabel: sparkWho(spark),
      ...pick,
      mode: h.input.projectRoots.length > 0 && !h.input.chatFolder ? 'ask' : 'chat',
      prompt,
      route: {
        name: spark.name,
        routedBy: 'fixed',
        spark: { id: spark.id, role: spark.role, only },
      },
    },
    h.deps.leaseSeconds,
  );
  const stopNow = new AbortController();
  const cancel = () => {
    stopNow.abort();
    void requestCancel(h.deps.db, lease.runId).catch(() => undefined);
  };
  h.control.signal.addEventListener('abort', cancel, { once: true });
  if (h.control.signal.aborted) {
    stopNow.abort();
    await requestCancel(h.deps.db, lease.runId);
  }
  await publish(h);
  try {
    const result = await executeChildRun(h.deps, lease, { stopNow: stopNow.signal }, h.append);
    return { spark, outcome: result.outcome, text: result.text, error: result.error };
  } finally {
    h.control.signal.removeEventListener('abort', cancel);
  }
}

async function noticeCancelSeenBySpark(h: Handoff): Promise<void> {
  if (h.control.signal.aborted) return;
  if (await isCancelRequested(h.deps.db, h.lease.runId)) h.control.stop('cancelled');
}

async function finishWithNote(h: Handoff, results: readonly SparkResult[], note: string) {
  const identity = h.input.identity;
  await updateOrchestration(h.deps.db, h.lease.runId, { phase: 'finished' });
  await publish(h);
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
  const mentions = findSparkMentions(input.userRequest, sparks);
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
  await publish(h);
  return {
    ...input,
    prompt: `${input.prompt}\n\n${note}`,
    userRequest: `${input.userRequest}\n\n${note}`,
  };
}
