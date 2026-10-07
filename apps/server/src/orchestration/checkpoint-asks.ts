import { runChanges } from '../projects/run-changes.ts';
import { acceptCard, askCard, CheckpointTimeout, type CheckpointCard } from './checkpoint.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { fixOptionLabel } from './review-loop.ts';
import { changedLines } from './member-prompts.ts';
import { checkTally } from './result-facts.ts';
import type { Session } from './session.ts';
import { lawItems, outsidePlanFiles } from '../laws/review.ts';
import type { FlowAction, FlowEvent } from './transitions.ts';

type Ask = Extract<FlowAction, { type: 'ask' }>;

async function keepCard(s: Session, action: Ask): Promise<CheckpointCard> {
  const changes = await runChanges(s.deps.db, s.input.workspaceId, s.lease.runId, true);
  const line = sessionReviewLine(s);
  const reason = line ? `${action.reason} ${line}` : action.reason;
  const lines = await changedLines(s);
  const card = acceptCard(
    changes.files,
    reason,
    fixOptionLabel(s.flow.review),
    lawItems(s),
    lines,
    outsidePlanFiles(s),
  );
  return { ...card, payload: { ...card.payload, checks: checkTally(s.checkBodies) } };
}

export async function ask(s: Session, action: Ask): Promise<FlowEvent> {
  const answer = await askCard(s, await keepCard(s, action));
  if (answer.type === 'stopped') return { type: 'stopped' };
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  return { type: 'answered', optionId: answer.optionId, note: answer.note };
}
