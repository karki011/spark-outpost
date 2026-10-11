import { prepareTurn } from '../compaction/prepare-turn.ts';
import { placeChatOrStop } from '../orchestration/chat-place.ts';
import { handToSparks } from '../orchestration/spark-handoff.ts';
import { recordKeptChanges } from '../outcomes/record.ts';
import { auditOutpostRequest } from '../outposts/request-audit.ts';
import { isStoryWrapUp } from '../outposts/user-asked.ts';
import { replyToWrapUp } from '../outposts/wrap-up-turn.ts';
import type { Lease } from '../persistence/jobs.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import { runChanges } from '../projects/run-changes.ts';
import { runAgentTurn, startControl, type TurnResult } from './agent-turn.ts';
import type { ChatTurnContext, ChatTurnDeps, ChatTurnHooks } from './chat-turn-hooks.ts';
import { withChatPrompt } from './chat-turn-prompt.ts';
import { chatTurnSteps } from './chat-turn-steps.ts';
import { failSafely, finishRun } from './execute-run.ts';
import { planNote } from './plan-recorder.ts';
import { noteProjectMove } from './project-move.ts';
import { runAppender } from './run-appender.ts';
import { runEvents } from './run-events.ts';
import { loadRunInput, type RunInput } from './run-input.ts';

type Start = Omit<ChatTurnContext, 'input'> & { hooks: ChatTurnHooks };

async function readyToWork(start: Start, asked: RunInput): Promise<RunInput | null> {
  const { deps, lease, append, hooks } = start;
  const prefs = await sparkPreferences(deps.db, asked.workspaceId);
  if (prefs.instructionsNote) await planNote(append, prefs.instructionsNote);
  const input = hooks.planTurn
    ? await hooks.planTurn(deps.db, asked)
    : { ...asked, planning: plansThisTurn(asked) };
  if (input.mode !== 'do') return input;
  const placed = await placeChatOrStop(deps, input, append, true, lease);
  return placed ? placed.input : null;
}

async function afterReply(
  turn: ChatTurnContext,
  hooks: ChatTurnHooks,
  reply: TurnResult,
): Promise<TurnResult> {
  if (reply.outcome !== 'succeeded') return reply;
  const { deps, lease, input } = turn;
  const result = hooks.publish ? await hooks.publish(turn, reply) : reply;
  if (!hooks.changesKept || input.mode !== 'do' || result.outcome === 'lease_lost') return result;
  const changes = await runChanges(deps.db, input.workspaceId, lease.runId, true);
  if (changes.files.length > 0) await hooks.changesKept(turn, changes.files);
  return result;
}

async function runTurn(deps: ChatTurnDeps, lease: Lease, hooks: ChatTurnHooks): Promise<void> {
  const append = runAppender(deps.db, lease);
  const control = startControl(deps, lease);
  const start = { deps, lease, append, control, hooks };
  let input = await loadRunInput(deps.db, lease.runId);
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    await auditOutpostRequest(deps.db, lease, input);
    input = await noteProjectMove(deps.db, input, append);
    const placed = await placeChatOrStop(deps, input, append, false);
    if (!placed) return;
    const prepared = await prepareTurn(deps, lease, placed.input, append, control);
    if (!prepared) return;
    input = prepared;
    if (isStoryWrapUp(input)) {
      const prompted = await withChatPrompt(deps, input);
      return await replyToWrapUp(prompted, lease, input, append, control);
    }
    const handed = await handToSparks({ deps, lease, input, append, control });
    if (handed === 'finished') return;
    const ready = await readyToWork(start, handed);
    if (!ready) return;
    input = ready;
    const prompted = await withChatPrompt(deps, input);
    const reply = await runAgentTurn(prompted, lease, input, append, control);
    const turn = { deps: prompted, lease, input, append, control };
    const result = await afterReply(turn, hooks, reply);
    await finishRun(append, input.identity, result, true);
  } catch (error) {
    if (error instanceof LeaseLostError || control.reason() === 'lease_lost') return;
    await failSafely(append, error);
  } finally {
    control.dispose();
    if (input.mode === 'do') await recordKeptChanges(deps.db, input.workspaceId, lease.runId);
  }
}

function chatTurnWith(hooks: ChatTurnHooks): (deps: ChatTurnDeps, lease: Lease) => Promise<void> {
  return (deps, lease) => runTurn(deps, lease, hooks);
}

export const runChatTurn = chatTurnWith(chatTurnSteps);
