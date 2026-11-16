import { z } from 'zod';
import {
  browserOrigin,
  originAndPath,
  signInOriginOf,
  signInOriginProblem,
  signInSites,
} from '@spark-outpost/contracts';
import { BrowserHostError } from '../../../browser/host-client.ts';
import { SIGN_IN_MISSING_SECRET, readSignInSecret } from '../../../browser/sign-ins.ts';
import {
  listSignInRows,
  noteRefusedSite,
  type SignInRow,
} from '../../../persistence/browser-sign-ins.ts';
import { actionRun } from '../../actions/confirm.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';
import {
  asToolError,
  auditBrowser,
  browserSession,
  chatHome,
  tabInput,
  type BrowserDecision,
} from './context.ts';
import { handOver } from './handoff.ts';
import type { PageFacts } from './read-flow.ts';
import { scrubberFor } from './scrub.ts';

const TOOL = 'spark_browser_sign_in';

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
      by: 'spark',
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

async function fill(context: SparkToolContext, attempt: Attempt) {
  const session = browserSession(context);
  const { row, page } = attempt;
  const secret = await readSignInSecret({ get: context.deps.secrets.fresh }, row.keychain_ref);
  if (!secret) {
    record(context, attempt, 'failed', { result: 'missing_from_keychain' });
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
    record(context, attempt, 'saved_sign_in', {
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
    record(context, attempt, 'failed', { result: error.code });
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

async function noteRefused(
  context: SparkToolContext,
  row: SignInRow,
  url: string,
): Promise<string | null> {
  const origin = browserOrigin(url);
  const site = origin === null ? null : signInOriginOf(origin);
  if (site !== null) await noteRefusedSite(context.deps.db, row.id, site);
  return site;
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
    const site = await noteRefused(context, row, page.url);
    await keepTab(context, page.tabId);
    return {
      ...notSignedIn(
        `${problem} Spark checked after the page finished loading and redirecting. Nothing was filled.`,
      ),
      signIn: row.label,
      tab: page.tabId,
      site: browserOrigin(page.url),
      requiresUserSiteApproval: site !== null,
      nextStep:
        site !== null
          ? `Ask the user to open Settings → Projects → Saved sign-ins for this chat's project, find "${row.label}", and choose Add this site for ${site} only if they trust that sign-in destination. Then retry spark_browser_sign_in with this label and tab. Do not ask them to enter credentials manually just because this site is not listed; manual handoff is for SSO, MFA, passkeys, unsupported forms, or their preference.`
          : 'This destination cannot be added as a saved sign-in site. Return to the intended HTTPS sign-in page; do not broaden the saved sites or fill this page.',
    };
  }
  return fill(context, attempt);
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
        : 'First check whether the shared Work browser is already signed in. Otherwise pass the intended label to spark_browser_sign_in; Spark checks the exact site before typing and returns Add this site instructions if the user must approve another origin. A different subdomain is not automatically approved and does not by itself require manual login. Spark types the values; you never see them. Use handOver true for SSO, MFA, passkeys, unsupported forms, or when the user prefers to sign in themselves.',
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
    "Spark types a saved sign-in into the tab's form (one page, or username then password) and submits it, only on that sign-in's sites, without a card. When a page asks you to sign in and a saved sign-in covers it, use it. handOver: the user signs in themselves in your tab (SSO, MFA, passkey); the call waits for them. Never returns the values.",
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
