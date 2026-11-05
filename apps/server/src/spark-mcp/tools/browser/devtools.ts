import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  BROWSER_EVAL_EXPRESSION_MAX,
  BROWSER_SELECTOR_MAX,
  UNTRUSTED_PAGE_NOTE,
  browserDevtoolsActionSchema,
  redactText,
  untrustedPage,
  withoutValue,
  withoutStorageSecrets,
  type BrowserDevtoolsAction,
  type BrowserStorageResult,
} from '@spark-outpost/contracts';
import { renderResult } from '../../format.ts';
import { SparkBlocks, SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';
import { allowedNote } from '../allowed-note.ts';
import { clearBrowse } from './browse-flow.ts';
import {
  asToolError,
  auditBrowser,
  browserSession,
  chatHome,
  pageParts,
  tabInput,
  type BrowserDecision,
} from './context.ts';
import { clearPage } from './read-flow.ts';
import { pageScrub, type Scrub } from './scrub.ts';

const TOOL = 'spark_browser_devtools';
const TAB_KEYS = new Set(['tabId', 'url', 'title', 'place', 'owner']);

interface DevtoolsArgs {
  action: BrowserDevtoolsAction;
  expression?: string | undefined;
  ref?: string | undefined;
  selector?: string | undefined;
  values?: boolean | undefined;
  tab?: string | undefined;
}

const EVAL_NOTE =
  'The value the page returned, as JSON when it can be. Values of password, card and code fields, of fields Spark filled, of the page’s cookies and of auth-looking storage are replaced with [masked] wherever they appear; anything else the page holds can be in it.';
const NOTES: Record<Exclude<BrowserDevtoolsAction, 'eval'>, string> = {
  inspect: 'Attributes, a subset of computed styles, the box and the accessible role and name.',
  performance:
    'Navigation timing in ms from navigation start, resource counts and the slowest five, and LCP, CLS, INP and long tasks where the page recorded them (null when it did not).',
  storage:
    'Keys and sizes; cookie names, domains and flags, never cookie values. Storage values only with values true and only in your own tab; auth-looking ones are masked.',
};

function withoutSecrets(found: BrowserStorageResult): BrowserStorageResult {
  const item = found.owner === 'agent' ? withoutStorageSecrets : withoutValue;
  return {
    ...found,
    local: found.local.map(item),
    session: found.session.map(item),
    cookies: found.cookies.map(withoutValue),
  };
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function blocks(facts: Record<string, unknown>, url: string, body: string, hidden: Scrub) {
  return new SparkBlocks([
    { type: 'text', text: renderResult(facts) },
    { type: 'text', text: untrustedPage(hidden(url), redactText(hidden(body))) },
  ]);
}

async function evaluate(args: DevtoolsArgs, context: SparkToolContext) {
  const expression = args.expression?.trim();
  if (!expression) throw new SparkToolError('Pass the JavaScript to run as expression.');
  const session = browserSession(context);
  const where = { chatId: session.chatId, runId: session.runId, tab: args.tab };
  const page = await session.host
    .request({ op: 'page', ...where }, context.signal)
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const hidden = await pageScrub(context);
  const userTab = page.owner === 'user';
  const audit = (decision: BrowserDecision) =>
    auditBrowser(context, {
      tool: TOOL,
      action: 'eval',
      page: page.url,
      place: page.place,
      decision,
      detail: {
        expression: redactText(hidden(expression)).slice(0, 2000),
        chars: expression.length,
        sha256: hashOf(expression),
        ...(userTab ? { userTab: true } : {}),
      },
    });
  const { origin, path } = pageParts(page.url);
  let decision: BrowserDecision = 'local';
  if (page.place === 'external' || userTab) {
    const home = await chatHome(context.deps.db, session.chatId);
    const cleared = await clearBrowse(
      context,
      {
        action: 'act_page',
        origin,
        path,
        title: page.title.slice(0, 300),
        did: `Run a script in the page (${expression.length} characters)`,
        userTab,
      },
      {
        url: page.url,
        userTab,
        send:
          page.place === 'external'
            ? { text: expression, subject: `Run a script on ${origin}${path}`, roots: home.roots }
            : null,
      },
    );
    if (!cleared.cleared) {
      audit(cleared.decision);
      return { ...cleared.result, tab: page.tabId };
    }
    decision = cleared.decision;
  }
  const done = await session.host
    .request({ op: 'evaluate', ...where, tab: page.tabId, expression, origin }, context.signal)
    .catch((error: unknown) => {
      audit('failed');
      throw asToolError(error);
    });
  audit(decision);
  if (page.place === 'external') {
    context.scope.observations?.record({ source: 'web_page', label: `web page ${origin}` });
  }
  const facts = {
    tab: done.tabId,
    url: hidden(done.url),
    type: done.type,
    ...(done.exception ? { threw: true } : {}),
    ...(done.truncated ? { truncated: true } : {}),
    ...(done.masked > 0 ? { maskedValues: done.masked } : {}),
    ...allowedNote(decision),
    note: `${EVAL_NOTE} ${UNTRUSTED_PAGE_NOTE}`,
  };
  return blocks(facts, done.url, done.exception ?? done.value, hidden);
}

async function readTool(args: DevtoolsArgs, context: SparkToolContext) {
  const action = args.action as Exclude<BrowserDevtoolsAction, 'eval'>;
  const session = browserSession(context);
  const where = { chatId: session.chatId, runId: session.runId, tab: args.tab };
  const request =
    action === 'inspect'
      ? ({ op: 'inspect', ...where, ref: args.ref, selector: args.selector } as const)
      : action === 'performance'
        ? ({ op: 'performance', ...where } as const)
        : ({ op: 'storage', ...where, values: args.values === true } as const);
  if (action === 'inspect' && !args.ref && !args.selector) {
    throw new SparkToolError('Pass a ref from spark_browser_read or a CSS selector.');
  }
  const found = await session.host.request(request, context.signal).catch((error: unknown) => {
    throw asToolError(error);
  });
  const cleared = await clearPage(context, TOOL, 'read', found, true);
  if (!cleared.cleared) return cleared.result;
  const hidden = await pageScrub(context);
  const { tabId, url, place } = found;
  const shown = action === 'storage' ? withoutSecrets(found as BrowserStorageResult) : found;
  const data = Object.fromEntries(Object.entries(shown).filter(([key]) => !TAB_KEYS.has(key)));
  const facts = {
    tab: tabId,
    url: hidden(url),
    place,
    action,
    ...allowedNote(cleared.decision),
    note: `${NOTES[action]} ${UNTRUSTED_PAGE_NOTE}`,
  };
  return blocks(facts, url, JSON.stringify(data, null, 1), hidden);
}

export const browserDevtoolsTool = sparkTool({
  name: TOOL,
  needs: 'browser',
  acts: true,
  title: 'Page developer tools',
  description:
    "Developer tools for a tab. eval runs JavaScript in the page (awaited, 10 s, capped, field values masked) and counts as acting: external sites follow the agent mode, a user's tab always asks. inspect: an element by ref or selector. performance: timings, LCP/CLS/INP, long tasks. storage: storage and cookies; no cookie values, storage values only in your own tab, auth-looking ones masked.",
  input: {
    action: browserDevtoolsActionSchema,
    expression: z.string().max(BROWSER_EVAL_EXPRESSION_MAX).optional(),
    ref: z.string().max(20).optional(),
    selector: z.string().max(BROWSER_SELECTOR_MAX).optional(),
    values: z.boolean().optional(),
    tab: tabInput,
  },
  run: (args, context) =>
    args.action === 'eval' ? evaluate(args, context) : readTool(args, context),
});
