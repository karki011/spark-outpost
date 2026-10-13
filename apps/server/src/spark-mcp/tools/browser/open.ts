import { z } from 'zod';
import { addressToUrl, classifyBrowserUrl, originAndPath } from '@spark-outpost/contracts';
import { BrowserHostError } from '../../../browser/host-client.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';
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
import { ensurePreview } from './preview.ts';
import { signInScrub } from './scrub.ts';

const TOOL = 'spark_browser_open';

interface OpenArgs {
  url?: string | undefined;
  tab?: string | undefined;
}

async function addressToOpen(args: OpenArgs, context: SparkToolContext) {
  if (args.url !== undefined) return { url: addressToUrl(args.url) };
  const preview = await ensurePreview(context, TOOL);
  return preview.ready ? { url: preview.url } : { result: preview.result };
}

async function open(args: OpenArgs, context: SparkToolContext) {
  const session = browserSession(context);
  const address = await addressToOpen(args, context);
  if ('result' in address) return address.result;
  const { url } = address;
  const kind = url ? classifyBrowserUrl(url) : 'blocked';
  if (!url || kind === 'blocked' || kind === 'blank') {
    throw new SparkToolError(
      'That is not an address the browser can open. Use an http or https address with no username or password in it, or a file inside a linked project.',
    );
  }
  const place = kind === 'external' ? 'external' : 'local';
  const home = await chatHome(context.deps.db, session.chatId);
  let decision: BrowserDecision = 'local';
  if (kind === 'external') {
    const cleared = await clearBrowse(
      context,
      { action: 'open_page', ...pageParts(url) },
      { url, send: { text: url, subject: `Open ${originAndPath(url)}`, roots: home.roots } },
    );
    if (!cleared.cleared) {
      auditBrowser(context, {
        tool: TOOL,
        action: 'open',
        page: url,
        place,
        decision: cleared.decision,
      });
      return cleared.result;
    }
    decision = cleared.decision;
  }
  const opened = await session.host
    .request(
      { op: 'open', chatId: session.chatId, runId: session.runId, url, tab: args.tab, ...home },
      context.signal,
    )
    .catch((error: unknown) => {
      const refused = error instanceof BrowserHostError && error.code === 'not_allowed';
      auditBrowser(context, {
        tool: TOOL,
        action: 'open',
        page: url,
        place,
        decision: refused ? 'refused' : 'failed',
      });
      throw asToolError(error);
    });
  const landed = originAndPath(opened.url);
  auditBrowser(context, {
    tool: TOOL,
    action: 'open',
    page: opened.url,
    place: opened.place,
    decision,
    ...(landed === originAndPath(url) ? {} : { detail: { asked: originAndPath(url) } }),
  });
  const hidden = (await signInScrub(context)) ?? ((text: string) => text);
  return {
    outcome: 'opened',
    tab: opened.tabId,
    url: hidden(opened.url),
    title: hidden(opened.title),
    status: opened.status,
    place: opened.place,
    reusedTab: opened.reused,
    note: 'Agent tabs close when this turn ends unless the user pins them.',
  };
}

export const browserOpenTool = sparkTool({
  name: TOOL,
  needs: 'browser',
  title: 'Open a page in the browser',
  description:
    "Opens any http(s) address, or a file inside a linked project, in this chat's Browser pane, where the user watches, and returns the final address, title, HTTP status and tab id. Use it to check your work on a local page or to research on the web. With no url it opens the project's preview, starting the preview server if needed (see spark_browser_preview). A site outside this computer follows the agent mode and may wait for the user; Spark's own ports and other schemes are refused. It reuses its own tab and never navigates a tab the user owns.",
  input: {
    url: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe('Address to open, for example http://localhost:5173/. Leave out for the preview.'),
    tab: tabInput,
  },
  run: open,
});
