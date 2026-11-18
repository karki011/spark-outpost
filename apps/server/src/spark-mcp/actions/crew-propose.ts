import { crewDecision } from '../../crew/crew-path.ts';
import {
  draftKey,
  pendingCrewCards,
  replaceDrafts,
  type CrewAction,
} from '../../crew/crew-drafts.ts';
import type { SparkToolContext } from '../tool.ts';
import { actionRun, proposeAction, type ProposeOptions } from './confirm.ts';

export async function proposeCrewAction(
  context: SparkToolContext,
  action: CrewAction,
  options: Omit<ProposeOptions, 'path' | 'observed' | 'alwaysAsk'> = {},
) {
  const run = actionRun(context.scope);
  const { db } = context.deps;
  const { workspaceId, conversationId } = run.scope;
  const key = draftKey(action);
  const before = conversationId
    ? (await pendingCrewCards(db, workspaceId, conversationId))
        .filter((card) => draftKey(card.action) === key)
        .map((card) => card.id)
    : [];
  const decision = await crewDecision(db, run.runId, run.scope.observations, action.action);
  const result = await proposeAction(context, action, {
    ...options,
    path: decision.path,
    observed: decision.observed,
  });
  const replaced = await replaceDrafts(db, before);
  return replaced > 0 ? { ...result, replacedDrafts: replaced } : result;
}
