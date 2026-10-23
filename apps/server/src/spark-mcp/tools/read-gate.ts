import {
  SPARK_ACTION_KIND,
  type AtlassianReadAction,
  type ServiceNowReadAction,
} from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { actionFacts, actionPath } from '../actions/action-policy.ts';
import { actionRun, auditAction, postCard, RESULT_WAIT_MS } from '../actions/confirm.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { cardDecision } from './browser/gate.ts';

export type ReadDecision = 'mode' | 'allowed_earlier' | 'user_allowed';

export type GatedRead = AtlassianReadAction | ServiceNowReadAction;

export type ReadClearance =
  | { cleared: true; decision: ReadDecision }
  | { cleared: false; outcome: 'waiting_for_user' | 'declined'; message: string };

const productOf = (action: GatedRead) => ('product' in action ? action.product : null);

async function readAllowedInChat(
  db: Queryable,
  conversationId: string,
  action: GatedRead,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.decided_by = 'user'
       AND a.payload->'sparkAction'->>'action' = $3
       AND ($4::text IS NULL OR a.payload->'sparkAction'->>'product' = $4)
     LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, action.action, productOf(action)],
  );
  return rows.length > 0;
}

export async function clearRead(
  context: SparkToolContext,
  action: GatedRead,
  name: string,
): Promise<ReadClearance> {
  const { scope, deps } = context;
  if (!scope.runId || !scope.conversationId || !scope.actions) {
    throw new SparkToolError(
      `This session cannot show the user a card right now, so Spark does not read ${name} here. Try again during a turn.`,
    );
  }
  const run = actionRun(scope);
  if (await readAllowedInChat(deps.db, scope.conversationId, action)) {
    auditAction(run, action, { outcome: 'performing', allowedEarlier: true });
    return { cleared: true, decision: 'allowed_earlier' };
  }
  const facts = await actionFacts(deps.db, scope.runId, action.action);
  if (actionPath(facts) === 'perform') {
    auditAction(run, action, { outcome: 'performing', ranWithoutReview: true });
    return { cleared: true, decision: 'mode' };
  }
  const card = await postCard(deps.db, run, action, {
    path: 'confirm',
    requested: facts.requested,
    observed: [],
  });
  auditAction(run, action, { outcome: 'waiting_for_user', approvalId: card.id });
  const outcome = await cardDecision(context, card.id, RESULT_WAIT_MS);
  if (outcome === 'allowed') return { cleared: true, decision: 'user_allowed' };
  return outcome === 'denied'
    ? {
        cleared: false,
        outcome: 'declined',
        message: `The user did not let you read ${name}. Do not try again unless they ask.`,
      }
    : {
        cleared: false,
        outcome: 'waiting_for_user',
        message: `Spark showed the user a card asking to let you read ${name}. Tell them it is waiting; call the tool again after they allow it.`,
      };
}

export function untrustedEvidence(tag: string, note: string, result: unknown): string {
  const body = JSON.stringify(result, null, 1).replace(
    new RegExp(`<(/?)${tag}`, 'gi'),
    `<$1${tag.replace('_', '-')}`,
  );
  return `<${tag} note="${note}">\n${body}\n</${tag}>`;
}
