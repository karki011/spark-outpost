import type { ReadPageAction } from '@spark-outpost/contracts';
import { SPARK_ACTION_KIND } from '@spark-outpost/contracts';
import { getApproval } from '../../../persistence/approvals.ts';
import type { Queryable } from '../../../persistence/db.ts';
import { actionFacts, actionPath, type ActionFacts } from '../../actions/action-policy.ts';
import { actionRun, postCard, RESULT_WAIT_MS } from '../../actions/confirm.ts';
import type { SparkToolContext } from '../../tool.ts';
import type { BrowserDecision } from './context.ts';

export type ReadPath = 'read' | 'ask';

export function externalReadPath(facts: ActionFacts): ReadPath {
  return actionPath({ ...facts, observed: false }) === 'perform' ? 'read' : 'ask';
}

export async function allowedEarlier(
  db: Queryable,
  conversationId: string,
  origin: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.decided_by = 'user'
       AND a.payload->'sparkAction'->>'action' = 'read_page'
       AND a.payload->'sparkAction'->>'origin' = $3
     LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, origin],
  );
  return rows.length > 0;
}

export interface Clearance {
  cleared: boolean;
  decision: BrowserDecision;
  approvalId?: string;
}

export const WAITING_FOR_PAGE =
  'Spark showed the user a card asking whether you may read this site. Tell them it is waiting; call the tool again after they allow it.';

export async function cardDecision(
  context: SparkToolContext,
  approvalId: string,
  waitMs: number,
): Promise<'allowed' | 'denied' | 'pending'> {
  const hooks = context.scope.actions!;
  const signal = context.signal ? AbortSignal.any([hooks.signal, context.signal]) : hooks.signal;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const current = await getApproval(context.deps.db, approvalId);
    if (!current) return 'denied';
    if (current.status === 'allowed') return 'allowed';
    if (current.status !== 'pending') return 'denied';
    const remaining = deadline - Date.now();
    if (signal.aborted || remaining <= 0) return 'pending';
    await hooks.waiters.wait(approvalId, Math.min(hooks.pollMs, remaining), signal);
  }
}

export async function clearExternalRead(
  context: SparkToolContext,
  action: ReadPageAction,
  waitMs = RESULT_WAIT_MS,
): Promise<Clearance> {
  const { scope, deps } = context;
  if (!scope.runId || !scope.conversationId || !scope.actions) {
    return { cleared: false, decision: 'user_declined' };
  }
  if (await allowedEarlier(deps.db, scope.conversationId, action.origin)) {
    return { cleared: true, decision: 'allowed_earlier' };
  }
  const facts = await actionFacts(deps.db, { runId: scope.runId, observed: false }, 'read_page');
  if (externalReadPath(facts) === 'read') return { cleared: true, decision: 'mode' };
  const card = await postCard(deps.db, actionRun(scope), action, {
    path: 'confirm',
    requested: facts.requested,
    observed: [],
  });
  const outcome = await cardDecision(context, card.id, waitMs);
  if (outcome === 'allowed')
    return { cleared: true, decision: 'user_allowed', approvalId: card.id };
  return {
    cleared: false,
    decision: outcome === 'denied' ? 'user_declined' : 'waiting_for_user',
    approvalId: card.id,
  };
}
