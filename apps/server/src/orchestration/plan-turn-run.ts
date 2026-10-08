import { markInPlaceMember } from '../persistence/orchestrations.ts';
import { runAgentTurn } from '../workflow/agent-turn.ts';
import type { FlowEvent } from './flow-types.ts';
import { checkAndFix, treeOf } from './land.ts';
import { labelFor, nameFor } from './member-routes.ts';
import { ensureParentSnapshot, type MemberOutcome } from './members.ts';
import { chatPick } from './routing.ts';
import type { MemberResult, Session } from './session.ts';
import type { NeedRead } from './simple-intake.ts';
import type { FlowAction } from './transitions.ts';

export const PLAN_TURN_NEED: NeedRead = { need: 'build', source: 'rules', confidence: null };
export const PLAN_TURN_WHY = 'a plan turn: the agent plans in its own plan mode, then builds';

export function startsPlanBuild(s: Session, action: Extract<FlowAction, { type: 'spawn' }>) {
  return s.planTurn === true && action.role === 'builder' && action.reason === 'first';
}

async function markAsBuilder(s: Session, name: string): Promise<void> {
  const pick = chatPick(s.route);
  await markInPlaceMember(s.deps.db, s.lease.runId, {
    role: 'builder',
    stepIndex: 0,
    attempt: 1,
    agentLabel: labelFor('builder', pick, name),
    provider: pick.provider,
    model: pick.model,
    effort: pick.effort,
    route: { name, modelLabel: pick.modelLabel },
  });
}

export async function buildFromPlan(s: Session): Promise<MemberOutcome> {
  const root = s.input.projectRoots[0]!;
  const before = await treeOf(s, root);
  await ensureParentSnapshot(s);
  const name = await nameFor(s, 'builder');
  const turn = await runAgentTurn(s.deps, s.lease, s.input, s.append, s.control);
  if (turn.messageId) s.message = { id: turn.messageId, text: turn.text };
  const result: MemberResult = {
    role: 'builder',
    runId: s.lease.runId,
    label: name,
    outcome: turn.outcome,
    error: turn.error,
    text: turn.text,
    toolCalls: 0,
    inPlace: true,
    name,
    loop: null,
  };
  s.results.push(result);
  if (result.outcome !== 'succeeded') return { result };
  const landed = await checkAndFix(s, result, { cwd: root, before, place: null });
  if (landed.changed) await markAsBuilder(s, name);
  return { result: landed.result };
}

export function planTurnEnd(
  outcome: MemberOutcome,
  event: FlowEvent,
): { status: 'succeeded' | 'failed'; reason: string | null } | null {
  if (event.type !== 'agent_done') return null;
  if (outcome.result.inPlace && event.outcome === 'failed') {
    return { status: 'failed', reason: event.error ?? 'The agent hit a problem.' };
  }
  return event.outcome === 'succeeded' && event.unchanged
    ? { status: 'succeeded', reason: null }
    : null;
}
