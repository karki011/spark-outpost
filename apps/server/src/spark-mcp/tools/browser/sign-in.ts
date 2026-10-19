import { z } from 'zod';
import {
  SPARK_ACTION_KIND,
  browserOrigin,
  originAndPath,
  signInOriginOf,
  signInOriginProblem,
  signInSites,
  type BrowserSignInAction,
} from '@spark-outpost/contracts';
import { BrowserHostError } from '../../../browser/host-client.ts';
import { SIGN_IN_MISSING_SECRET, readSignInSecret } from '../../../browser/sign-ins.ts';
import {
  listSignInRows,
  noteRefusedSite,
  type SignInRow,
} from '../../../persistence/browser-sign-ins.ts';
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
import { handOver } from './handoff.ts';
import type { PageFacts } from './read-flow.ts';
import { scrubberFor } from './scrub.ts';
import { allowedNote } from '../allowed-note.ts';

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

function sitesKey(row: SignInRow): string {
  return JSON.stringify(signInSites(row));
}

async function allowedEarlier(db: Queryable, conversationId: string, row: SignInRow) {
  const { rows } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.decided_by = 'user'
       AND a.payload->'sparkAction'->>'action' = 'browser_sign_in'
       AND a.payload->'sparkAction'->>'signInId' = $3
       AND a.payload->'sparkAction'->'sites' = $4::jsonb
     LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, row.id, sitesKey(row)],
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

async function clearSignIn(
  context: SparkToolContext,
  row: SignInRow,
  site: string,
): Promise<Clearance> {
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
    site,
    sites: signInSites(row),
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
      signInSites: signInSites(row),
      by: decidedByUser ? 'user' : decision === 'waiting_for_user' ? null : 'spark',
      ...detail,
    },
  });
}

const notSignedIn = (reason: string) => ({ outcome: 'not_signed_in', reason });

async function keepTab(context: SparkToolContext, tab: string): Promise<void> {
  const session = browserSession(context);
  await session.host
    .request({ op: 'keep', chatId: session.chatId, runId: session.runId, tab })
    .catch(() => undefined);
}

async function fill(context: SparkToolContext, attempt: Attempt, clearance: Clearance) {
  const session = browserSession(context);
  const { row, page } = attempt;
  const approval = clearance.approvalId ? { approvalId: clearance.approvalId } : {};
  const secret = await readSignInSecret({ get: context.deps.secrets.fresh }, row.keychain_ref);
  if (!secret) {
    record(context, attempt, 'failed', { ...approval, result: 'missing_from_keychain' });
    await keepTab(context, page.tabId);
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
        sites: signInSites(row),
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
      ...allowedNote(clearance.decision),
      note: SIGN_IN_NOTE,
    };
  } catch (error) {
    if (!(error instanceof BrowserHostError)) throw error;
    record(context, attempt, 'failed', { ...approval, result: error.code });
    await keepTab(context, page.tabId);
    return notSignedIn(hidden(asToolError(error).message));
  }
}

interface SignInArgs {
  signIn?: string | undefined;
  tab?: string | undefined;
  handOver?: boolean | undefined;
}

const NO_LABEL =
  'Pass signIn with a label from spark_browser_signins, or handOver true to let the user sign in themselves.';

async function noteRefused(context: SparkToolContext, row: SignInRow, url: string): Promise<void> {
  const origin = browserOrigin(url);
  const site = origin === null ? null : signInOriginOf(origin);
  if (site !== null) await noteRefusedSite(context.deps.db, row.id, site);
}

async function signIn(args: SignInArgs, context: SparkToolContext) {
  if (args.handOver) return handOver(context, args.tab);
  if (!args.signIn) throw new SparkToolError(NO_LABEL);
  const session = browserSession(context);
  actionRun(context.scope);
  const row = chosen(await projectRows(context, session.chatId), args.signIn);
  const page = await session.host
    .request(
      { op: 'page', chatId: session.chatId, runId: session.runId, tab: args.tab, settle: true },
      context.signal,
    )
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const attempt = { row, page };
  const problem = signInOriginProblem(signInSites(row), page.url);
  if (problem) {
    record(context, attempt, 'refused_origin');
    await noteRefused(context, row, page.url);
    await keepTab(context, page.tabId);
    return notSignedIn(
      `${problem} Spark checked after the page finished loading and redirecting. Nothing was filled.`,
    );
  }
  const clearance = await clearSignIn(context, row, browserOrigin(page.url) ?? row.origin);
  if (clearance.decision === 'waiting_for_user' || clearance.decision === 'user_declined') {
    record(context, attempt, clearance.decision, { approvalId: clearance.approvalId });
    const waiting = clearance.decision === 'waiting_for_user';
    if (waiting) await keepTab(context, page.tabId);
    return {
      outcome: waiting ? 'waiting_for_user' : 'declined',
      signIn: row.label,
      site: browserOrigin(page.url) ?? row.origin,
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
    signIns: rows.map((row) => ({ id: row.id, label: row.label, sites: signInSites(row) })),
    note:
      rows.length === 0
        ? 'No sign-ins are saved for this chat’s project. The user adds them in Settings, Projects, Saved sign-ins.'
        : 'Pass a label to spark_browser_sign_in while a tab is on one of its sites. Spark types the values; you never see them. For SSO, MFA or a passkey, pass handOver true so the user signs in.',
  };
}

const browserSignInsTool = sparkTool({
  name: 'spark_browser_signins',
  needs: 'browser',
  title: 'Saved sign-ins',
  description:
    "Saved test sign-ins of this chat's project: label and sites. Values stay in the keychain and no tool returns them.",
  input: {},
  run: (_args, context) => signIns(context),
});

const browserSignInTool = sparkTool({
  name: TOOL,
  needs: 'browser',
  acts: true,
  title: 'Sign in with a saved sign-in',
  description:
    "Spark types a saved sign-in into the tab's form (one page, or username then password) and submits it, only on that sign-in's sites. First use in a chat asks, in every mode. handOver: the user signs in themselves in your tab (SSO, MFA, passkey); the call waits for them. Never returns the values.",
  input: {
    signIn: z
      .string()
      .min(1)
      .max(60)
      .optional()
      .describe('Label or id from spark_browser_signins.'),
    tab: tabInput,
    handOver: z.boolean().optional(),
  },
  run: signIn,
});

export const browserSignInTools = [browserSignInsTool, browserSignInTool];
