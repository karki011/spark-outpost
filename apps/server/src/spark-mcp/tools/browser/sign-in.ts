import { z } from 'zod';
import {
  SPARK_ACTION_KIND,
  originAndPath,
  signInOriginProblem,
  type BrowserSignInAction,
} from '@spark-outpost/contracts';
import { BrowserHostError } from '../../../browser/host-client.ts';
import { SIGN_IN_MISSING_SECRET, readSignInSecret } from '../../../browser/sign-ins.ts';
import { listSignInRows, type SignInRow } from '../../../persistence/browser-sign-ins.ts';
import type { Queryable } from '../../../persistence/db.ts';
import { actionRun, postCard, RESULT_WAIT_MS } from '../../actions/confirm.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';
import {
  asToolError,
  auditBrowser,
  browserSession,
  chatHome,
  tabInput,
  type BrowserDecision,
} from './context.ts';
import { cardDecision } from './gate.ts';
import type { PageFacts } from './read-flow.ts';
import { scrubberFor } from './scrub.ts';

const TOOL = 'spark_browser_sign_in';

export const WAITING_FOR_SIGN_IN =
  'Spark showed the user a card asking whether you may use this saved sign-in. Tell them it is waiting; call the tool again after they allow it.';
export const SIGN_IN_DECLINED =
  'The user did not allow this sign-in. Do not try again unless they ask.';
export const SIGN_IN_NOTE =
  'Spark typed the saved username and password into the page and submitted the form. Read the page to check that it signed in. The values are never shown to you; do not ask the user for them.';
const NO_PROJECT = 'Saved sign-ins belong to a project, and this chat has none linked.';

async function projectRows(context: SparkToolContext, chatId: string): Promise<SignInRow[]> {
  const { projectId } = await chatHome(context.deps.db, chatId);
  if (!projectId) throw new SparkToolError(NO_PROJECT);
  return listSignInRows(context.deps.db, projectId);
}

function chosen(rows: readonly SignInRow[], wanted: string): SignInRow {
  const name = wanted.trim().toLowerCase();
  const row = rows.find(
    (candidate) => candidate.id === name || candidate.label.toLowerCase() === name,
  );
  if (!row) {
    throw new SparkToolError(
      'No saved sign-in has that label or id. spark_browser_signins lists the ones this chat can use; the user adds them in Settings, Projects.',
    );
  }
  return row;
}

async function allowedEarlier(db: Queryable, conversationId: string, row: SignInRow) {
  const { rows } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.decided_by = 'user'
       AND a.payload->'sparkAction'->>'action' = 'browser_sign_in'
       AND a.payload->'sparkAction'->>'signInId' = $3
       AND a.payload->'sparkAction'->>'origin' = $4
     LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, row.id, row.origin],
  );
  return rows.length > 0;
}

interface Clearance {
  decision: Extract<
    BrowserDecision,
    'allowed_earlier' | 'user_allowed' | 'user_declined' | 'waiting_for_user'
  >;
  approvalId?: string;
}

async function clearSignIn(context: SparkToolContext, row: SignInRow): Promise<Clearance> {
  const run = actionRun(context.scope);
  const conversationId = context.scope.conversationId!;
  if (await allowedEarlier(context.deps.db, conversationId, row)) {
    return { decision: 'allowed_earlier' };
  }
  const action: BrowserSignInAction = {
    action: 'browser_sign_in',
    signInId: row.id,
    projectId: row.project_id,
    label: row.label,
    origin: row.origin,
  };
  const card = await postCard(context.deps.db, run, action, {
    path: 'confirm',
    requested: false,
    observed: [],
  });
  const outcome = await cardDecision(context, card.id, RESULT_WAIT_MS);
  const decision =
    outcome === 'allowed'
      ? 'user_allowed'
      : outcome === 'denied'
        ? 'user_declined'
        : 'waiting_for_user';
  return { decision, approvalId: card.id };
}

interface Attempt {
  row: SignInRow;
  page: PageFacts;
}

function record(
  context: SparkToolContext,
  { row, page }: Attempt,
  decision: BrowserDecision,
  detail: Record<string, unknown> = {},
): void {
  const decidedByUser =
    decision === 'user_allowed' || decision === 'allowed_earlier' || decision === 'user_declined';
  auditBrowser(context, {
    tool: TOOL,
    action: 'sign_in',
    page: page.url,
    place: page.place,
    decision,
    detail: {
      signIn: row.label,
      signInOrigin: row.origin,
      by: decidedByUser ? 'user' : decision === 'waiting_for_user' ? null : 'spark',
      ...detail,
    },
  });
}

const notSignedIn = (reason: string) => ({ outcome: 'not_signed_in', reason });

async function fill(context: SparkToolContext, attempt: Attempt, clearance: Clearance) {
  const session = browserSession(context);
  const { row, page } = attempt;
  const approval = clearance.approvalId ? { approvalId: clearance.approvalId } : {};
  const secret = await readSignInSecret({ get: context.deps.secrets.fresh }, row.keychain_ref);
  if (!secret) {
    record(context, attempt, 'failed', { ...approval, result: 'missing_from_keychain' });
    return notSignedIn(SIGN_IN_MISSING_SECRET);
  }
  const hidden = scrubberFor([secret]) ?? ((text: string) => text);
  try {
    const done = await session.host.request(
      {
        op: 'sign_in',
        chatId: session.chatId,
        runId: session.runId,
        tab: page.tabId,
        origin: row.origin,
        username: secret.username,
        password: secret.password,
      },
      context.signal,
    );
    const landed = hidden(originAndPath(done.url));
    record(context, attempt, clearance.decision, {
      ...approval,
      result: 'form_submitted',
      steps: done.steps,
    });
    return {
      outcome: 'form_submitted',
      signIn: row.label,
      tab: done.tabId,
      page: landed,
      steps: done.steps,
      note: SIGN_IN_NOTE,
    };
  } catch (error) {
    if (!(error instanceof BrowserHostError)) throw error;
    record(context, attempt, 'failed', { ...approval, result: error.code });
    return notSignedIn(hidden(asToolError(error).message));
  }
}

interface SignInArgs {
  signIn: string;
  tab?: string | undefined;
}

async function signIn(args: SignInArgs, context: SparkToolContext) {
  const session = browserSession(context);
  actionRun(context.scope);
  const row = chosen(await projectRows(context, session.chatId), args.signIn);
  const page = await session.host
    .request(
      { op: 'page', chatId: session.chatId, runId: session.runId, tab: args.tab },
      context.signal,
    )
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const attempt = { row, page };
  const problem = signInOriginProblem(row.origin, page.url);
  if (problem) {
    record(context, attempt, 'refused_origin');
    return notSignedIn(`${problem} Nothing was filled.`);
  }
  const clearance = await clearSignIn(context, row);
  if (clearance.decision === 'waiting_for_user' || clearance.decision === 'user_declined') {
    record(context, attempt, clearance.decision, { approvalId: clearance.approvalId });
    const waiting = clearance.decision === 'waiting_for_user';
    return {
      outcome: waiting ? 'waiting_for_user' : 'declined',
      signIn: row.label,
      site: row.origin,
      message: waiting ? WAITING_FOR_SIGN_IN : SIGN_IN_DECLINED,
    };
  }
  return fill(context, attempt, clearance);
}

async function signIns(context: SparkToolContext) {
  const session = browserSession(context);
  const { projectId } = await chatHome(context.deps.db, session.chatId);
  const rows = projectId ? await listSignInRows(context.deps.db, projectId) : [];
  auditBrowser(context, {
    tool: 'spark_browser_signins',
    action: 'sign_ins',
    page: null,
    place: null,
    decision: 'local',
  });
  return {
    signIns: rows.map((row) => ({ id: row.id, label: row.label, site: row.origin })),
    note:
      rows.length === 0
        ? 'No sign-ins are saved for this chat’s project. The user adds them in Settings, Projects, Saved sign-ins.'
        : 'Pass a label to spark_browser_sign_in while a tab is on that exact site. Spark types the values; you never see them.',
  };
}

const browserSignInsTool = sparkTool({
  name: 'spark_browser_signins',
  needs: 'browser',
  title: 'Saved sign-ins',
  description:
    "The test sign-ins the user saved for this chat's project: label and site only. Usernames and passwords stay in the Mac keychain and are never returned by any tool.",
  input: {},
  run: (_args, context) => signIns(context),
});

const browserSignInTool = sparkTool({
  name: TOOL,
  needs: 'browser',
  acts: true,
  title: 'Sign in with a saved sign-in',
  description:
    'Asks Spark to type a saved username and password into the sign-in form of a Browser pane tab and submit it. Works only when the tab is on exactly the saved site (https, or a local development host), on the page itself and not in a frame; it handles a username page followed by a password page. The first use of a sign-in in a chat waits for the user on a card, in every agent mode. Returns form_submitted with the page it landed on, or the reason nothing was filled. It never returns the values, and the fields it filled stay masked.',
  input: {
    signIn: z.string().min(1).max(60).describe('Label or id from spark_browser_signins.'),
    tab: tabInput,
  },
  run: signIn,
});

export const browserSignInTools = [browserSignInsTool, browserSignInTool];
