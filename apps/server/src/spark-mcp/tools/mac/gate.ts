import {
  SPARK_ACTION_KIND,
  type MacActAction,
  type MacApp,
  type MacPressAction,
  type MacUseAppAction,
} from '@spark-outpost/contracts';
import type { Queryable } from '../../../persistence/db.ts';
import { actionFacts, actionPath } from '../../actions/action-policy.ts';
import { actionRun, postCard, RESULT_WAIT_MS } from '../../actions/confirm.ts';
import type { SparkToolContext } from '../../tool.ts';
import { cardDecision } from '../browser/gate.ts';
import { MacToolError, type MacDecision } from './context.ts';

export interface MacClearance {
  cleared: boolean;
  decision: MacDecision;
  approvalId?: string;
}

export const WAITING_FOR_APP =
  'Spark showed the user a card about this app on their Mac. Tell them it is waiting; call the tool again after they allow it.';

export const DECLINED_APP =
  'The user did not allow this in the app. Do not try again unless they ask.';

const NO_CARDS =
  'This session cannot show the user a card right now, so Spark does not do this. Ask the user to do it themselves, or try again during a turn.';

async function appsOfChat(
  db: Queryable,
  conversationId: string,
  action: 'mac_use_app' | 'mac_act',
  statuses: readonly string[],
): Promise<string[]> {
  const { rows } = await db.query<{ bundle_id: string }>(
    `SELECT DISTINCT a.payload->'sparkAction'->>'bundleId' AS bundle_id
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2
       AND a.payload->'sparkAction'->>'action' = $3
       AND a.status = ANY($4::text[])
       AND (a.status = 'pending' OR a.decided_by = 'user')`,
    [conversationId, SPARK_ACTION_KIND, action, statuses],
  );
  return rows.map((row) => row.bundle_id);
}

export function allowedApps(db: Queryable, conversationId: string): Promise<string[]> {
  return appsOfChat(db, conversationId, 'mac_use_app', ['allowed']);
}

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function onlyApp(db: Queryable, conversationId: string, app: MacApp): Promise<void> {
  const taken = await appsOfChat(db, conversationId, 'mac_use_app', ['allowed', 'pending']);
  const other = taken.find((bundleId) => !sameId(bundleId, app.bundleId ?? ''));
  if (other) {
    throw new MacToolError(
      'one_app_per_chat',
      `Mac control works in one app per chat for now, and this chat uses ${other}. Ask the user to start a new chat for ${app.name}.`,
    );
  }
}

async function waitFor(
  context: SparkToolContext,
  action: MacUseAppAction | MacActAction | MacPressAction,
  waitMs: number,
  requested: boolean,
): Promise<MacClearance> {
  const card = await postCard(context.deps.db, actionRun(context.scope), action, {
    path: 'confirm',
    requested,
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

function canAsk(context: SparkToolContext): boolean {
  return Boolean(context.scope.runId && context.scope.conversationId && context.scope.actions);
}

export async function clearMacApp(
  context: SparkToolContext,
  app: MacApp,
  first: string,
): Promise<MacClearance> {
  const conversationId = context.scope.conversationId!;
  const bundleId = app.bundleId ?? app.name;
  const allowed = await allowedApps(context.deps.db, conversationId);
  if (allowed.some((id) => sameId(id, bundleId)))
    return { cleared: true, decision: 'allowed_earlier' };
  await onlyApp(context.deps.db, conversationId, app);
  if (!canAsk(context)) throw new MacToolError('no_cards', NO_CARDS);
  return waitFor(
    context,
    { action: 'mac_use_app', app: app.name, bundleId, first: first.slice(0, 300) },
    RESULT_WAIT_MS,
    false,
  );
}

export async function clearMacAct(
  context: SparkToolContext,
  app: MacApp,
  did: string,
): Promise<MacClearance> {
  const { scope, deps } = context;
  const bundleId = app.bundleId ?? app.name;
  if (!canAsk(context)) throw new MacToolError('no_cards', NO_CARDS);
  const facts = await actionFacts(deps.db, scope.runId!, 'mac_act');
  if (actionPath(facts) === 'perform') return { cleared: true, decision: 'mode' };
  const allowed = await appsOfChat(deps.db, scope.conversationId!, 'mac_act', ['allowed']);
  if (allowed.some((id) => sameId(id, bundleId)))
    return { cleared: true, decision: 'allowed_earlier' };
  return waitFor(
    context,
    { action: 'mac_act', app: app.name, bundleId, did: did.slice(0, 300) },
    RESULT_WAIT_MS,
    facts.requested,
  );
}

export async function clearMacPress(
  context: SparkToolContext,
  app: MacApp,
  what: string,
  window: string | null,
): Promise<MacClearance> {
  if (!canAsk(context)) throw new MacToolError('no_cards', NO_CARDS);
  const action: MacPressAction = {
    action: 'mac_press',
    app: app.name,
    bundleId: app.bundleId ?? app.name,
    what: what.slice(0, 300),
    window: window?.slice(0, 300) ?? null,
  };
  return waitFor(context, action, context.scope.actions!.timeoutMs, false);
}
