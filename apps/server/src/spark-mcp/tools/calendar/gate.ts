import { SPARK_ACTION_KIND, type CalendarReadAction } from '@spark-outpost/contracts';
import type { Queryable } from '../../../persistence/db.ts';
import { actionFacts, actionPath } from '../../actions/action-policy.ts';
import { actionRun, postCard, RESULT_WAIT_MS } from '../../actions/confirm.ts';
import type { SparkToolContext } from '../../tool.ts';
import { cardDecision } from '../browser/gate.ts';
import { CalendarToolError, type CalendarDecision } from './context.ts';

export interface CalendarClearance {
  cleared: boolean;
  decision: CalendarDecision;
  approvalId?: string;
}

export const WAITING_FOR_CALENDAR =
  'Spark showed the user a card asking to let you read their calendar. Tell them it is waiting; call the tool again after they allow it.';

export const DECLINED_CALENDAR =
  'The user did not let you read their calendar. Do not try again unless they ask.';

const NO_CARDS =
  'This session cannot show the user a card right now, so Spark does not read the calendar here. Try again during a turn.';

export async function readAllowedInChat(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.decided_by = 'user'
       AND a.payload->'sparkAction'->>'action' = 'calendar_read'
     LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND],
  );
  return rows.length > 0;
}

export async function clearCalendarRead(
  context: SparkToolContext,
  what: string,
): Promise<CalendarClearance> {
  const { scope, deps } = context;
  if (!scope.runId || !scope.conversationId || !scope.actions) {
    throw new CalendarToolError('no_cards', NO_CARDS);
  }
  if (await readAllowedInChat(deps.db, scope.conversationId)) {
    return { cleared: true, decision: 'allowed_earlier' };
  }
  const facts = await actionFacts(deps.db, scope.runId, 'calendar_read');
  if (actionPath(facts) === 'perform') return { cleared: true, decision: 'mode' };
  const action: CalendarReadAction = { action: 'calendar_read', what: what.slice(0, 300) };
  const card = await postCard(deps.db, actionRun(scope), action, {
    path: 'confirm',
    requested: facts.requested,
    observed: [],
  });
  const outcome = await cardDecision(context, card.id, RESULT_WAIT_MS);
  if (outcome === 'allowed') {
    return { cleared: true, decision: 'user_allowed', approvalId: card.id };
  }
  return {
    cleared: false,
    decision: outcome === 'denied' ? 'user_declined' : 'waiting_for_user',
    approvalId: card.id,
  };
}
