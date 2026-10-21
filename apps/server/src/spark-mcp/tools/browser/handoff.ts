import {
  SPARK_ACTION_KIND,
  browserOrigin,
  originAndPath,
  providerLabel,
  type BrowserHandoff,
  type BrowserHandoffAction,
} from '@spark-outpost/contracts';
import { BrowserHostError } from '../../../browser/host-client.ts';
import type { Queryable } from '../../../persistence/db.ts';
import { actionRun, postCard } from '../../actions/confirm.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';
import { asToolError, auditBrowser, browserSession, type BrowserDecision } from './context.ts';
import { cardDecision } from './gate.ts';
import { pageScrub } from './scrub.ts';

const TOOL = 'spark_browser_sign_in';

export const HANDOFF_WAIT_MS = 55 * 60_000;

export const HANDOFF_DONE_NOTE =
  'The user finished in the tab and handed it back. Read the page to check that it is signed in. You never see what they typed; do not ask for it.';
export const HANDOFF_STILL_WAITING =
  'The user has not finished signing in yet, and the tab is still theirs. Call spark_browser_sign_in with handOver true again to keep waiting; Spark sets no limit.';
export const HANDOFF_CANCELLED = 'The user cancelled the sign-in. Do not ask again unless they do.';
export const HANDOFF_TAB_CLOSED =
  'The user closed the tab, so the sign-in was cancelled. Do not ask again unless they do.';
export const HANDOFF_TAB_GONE =
  'The tab you handed over is gone, so nothing was handed back. Open the site again and check whether it is signed in before asking the user again.';
const NOT_A_PAGE = 'Open the sign-in page in your tab first; the tab is not on a web page.';

interface Waiting {
  approvalId: string;
  tabId: string;
  site: string;
  agent: string;
}

async function agentName(db: Queryable, runId: string): Promise<string> {
  const { rows } = await db.query<{ provider: string | null }>(
    'SELECT provider FROM runs WHERE id = $1',
    [runId],
  );
  const provider = rows[0]?.provider;
  return provider ? providerLabel(provider) : 'The agent';
}

async function waitingHandoff(
  db: Queryable,
  runId: string,
  tab: string | undefined,
): Promise<Waiting | null> {
  const { rows } = await db.query<{ id: string; action: BrowserHandoffAction }>(
    `SELECT id, payload->'sparkAction' AS action FROM approvals
     WHERE run_id = $1 AND kind = $2 AND status = 'pending'
       AND payload->'sparkAction'->>'action' = 'browser_handoff'
       AND ($3::text IS NULL OR payload->'sparkAction'->>'tabId' = $3)
     ORDER BY created_at DESC LIMIT 1`,
    [runId, SPARK_ACTION_KIND, tab ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    approvalId: row.id,
    tabId: row.action.tabId,
    site: row.action.site,
    agent: row.action.agent,
  };
}

async function startHandoff(context: SparkToolContext, tab: string | undefined): Promise<Waiting> {
  const session = browserSession(context);
  const run = actionRun(context.scope);
  const page = await session.host
    .request(
      { op: 'page', chatId: session.chatId, runId: session.runId, tab, settle: true },
      context.signal,
    )
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const site = browserOrigin(page.url);
  if (site === null || site === 'file://' || page.url === 'about:blank') {
    throw new SparkToolError(NOT_A_PAGE);
  }
  const action: BrowserHandoffAction = {
    action: 'browser_handoff',
    agent: await agentName(context.deps.db, run.runId),
    site,
    tabId: page.tabId,
  };
  const card = await postCard(context.deps.db, run, action, {
    path: 'confirm',
    requested: false,
    observed: [],
    declineName: 'Cancel',
  });
  return { approvalId: card.id, tabId: page.tabId, site, agent: action.agent };
}

function holdTab(context: SparkToolContext, tabId: string, handoff: BrowserHandoff | null) {
  const session = browserSession(context);
  return session.host.request({
    op: 'hand_over',
    chatId: session.chatId,
    runId: session.runId,
    tab: tabId,
    handoff,
  });
}

function record(
  context: SparkToolContext,
  waiting: Waiting,
  decision: BrowserDecision,
  result: string,
) {
  auditBrowser(context, {
    tool: TOOL,
    action: 'hand_over',
    page: waiting.site,
    place: null,
    decision,
    detail: {
      approvalId: waiting.approvalId,
      by: decision === 'waiting_for_user' ? null : 'user',
      result,
    },
  });
}

function stopped(context: SparkToolContext): boolean {
  return context.signal?.aborted === true || context.scope.actions?.signal.aborted === true;
}

export async function handOver(context: SparkToolContext, tab: string | undefined) {
  const run = actionRun(context.scope);
  const resumed = await waitingHandoff(context.deps.db, run.runId, tab);
  const waiting = resumed ?? (await startHandoff(context, tab));
  const { approvalId, agent, site, tabId } = waiting;
  await holdTab(context, tabId, { agent, site, approvalId }).catch((error: unknown) => {
    throw asToolError(error);
  });
  if (!resumed) record(context, waiting, 'waiting_for_user', 'waiting');
  const outcome = await cardDecision(context, approvalId, HANDOFF_WAIT_MS);
  if (outcome === 'pending' && !stopped(context)) {
    return { outcome: 'waiting_for_user', tab: tabId, site, message: HANDOFF_STILL_WAITING };
  }
  let tabClosed = false;
  const released = await holdTab(context, tabId, null).catch((error: unknown) => {
    tabClosed = error instanceof BrowserHostError && error.code === 'no_tab';
    return null;
  });
  if (outcome !== 'allowed' && stopped(context)) {
    record(context, waiting, 'user_declined', 'stopped');
    return { outcome: 'cancelled', tab: tabId, site, message: HANDOFF_CANCELLED };
  }
  if (outcome !== 'allowed' && tabClosed) {
    record(context, waiting, 'user_declined', 'tab_closed');
    return { outcome: 'tab_closed', tab: tabId, site, message: HANDOFF_TAB_CLOSED };
  }
  if (outcome !== 'allowed') {
    record(context, waiting, 'user_declined', 'cancelled');
    return { outcome: 'cancelled', tab: tabId, site, message: HANDOFF_CANCELLED };
  }
  if (!released) {
    record(context, waiting, 'user_allowed', 'tab_gone');
    return { outcome: 'tab_gone', tab: tabId, site, message: HANDOFF_TAB_GONE };
  }
  record(context, waiting, 'user_allowed', 'handed_back');
  const hidden = await pageScrub(context);
  return {
    outcome: 'handed_back',
    tab: tabId,
    page: hidden(originAndPath(released.url)),
    note: HANDOFF_DONE_NOTE,
  };
}
