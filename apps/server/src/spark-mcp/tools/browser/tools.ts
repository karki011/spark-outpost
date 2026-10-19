import { z } from 'zod';
import {
  BROWSER_READ_MAX_CHARS,
  BROWSER_READ_MIN_CHARS,
  UNTRUSTED_PAGE_NOTE,
  browserReadModeSchema,
  browserReadScopeSchema,
  originAndPath,
  redactText,
  untrustedPage,
  type BrowserReadResult,
} from '@spark-outpost/contracts';
import { renderResult } from '../../format.ts';
import { SparkBlocks, sparkTool, type SparkToolContext } from '../../tool.ts';
import { browserActTool } from './act.ts';
import { asToolError, auditBrowser, browserSession, tabInput } from './context.ts';
import { browserDevtoolsTool } from './devtools.ts';
import { browserLogsTool } from './logs.ts';
import { browserOpenTool } from './open.ts';
import { browserPreviewTool } from './preview.ts';
import { clearPage } from './read-flow.ts';
import { browserScreenshotTool } from './screenshot.ts';
import { signInScrub } from './scrub.ts';
import { browserSignInTools } from './sign-in.ts';
import { allowedNote } from '../allowed-note.ts';

const keep = (text: string) => text;

async function tabs(context: SparkToolContext) {
  const session = browserSession(context);
  const listed = await session.host
    .request({ op: 'tabs', chatId: session.chatId, runId: session.runId }, context.signal)
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  auditBrowser(context, {
    tool: 'spark_browser_tabs',
    action: 'tabs',
    page: null,
    place: null,
    decision: 'local',
  });
  const hidden = (await signInScrub(context)) ?? keep;
  return {
    tabs: listed.tabs.map((tab) => ({
      ...tab,
      title: hidden(tab.title),
      url: hidden(tab.place === 'external' ? originAndPath(tab.url) : tab.url),
    })),
    note: `Titles and addresses come from pages. ${UNTRUSTED_PAGE_NOTE}`,
  };
}

interface ReadArgs {
  tab?: string | undefined;
  mode: z.infer<typeof browserReadModeSchema>;
  scope?: z.infer<typeof browserReadScopeSchema> | undefined;
  ref?: string | undefined;
  offset: number;
  maxChars?: number | undefined;
}

function readNote(page: BrowserReadResult) {
  const notes = [
    page.mode === 'tree'
      ? 'Outline of the page. [ref_N] names an element for ref and stays on it until the page navigates. Password and card fields show [masked].'
      : 'Visible text of the page, without field values.',
  ];
  if (page.leftOut > 0) {
    notes.push(
      `${page.leftOut} lines were left out to fit; each gap says which ref to read for them.`,
    );
  }
  if (page.main === 'whole_page') {
    notes.push('No main region was found, so this is the whole page.');
  }
  if (page.dialog && page.pageRef) {
    notes.push(
      `A dialog is open, so this is the dialog only. Pass ref ${page.pageRef} for the whole page.`,
    );
  }
  return notes.join(' ');
}

async function read(args: ReadArgs, context: SparkToolContext) {
  const session = browserSession(context);
  const page = await session.host
    .request({ op: 'read', chatId: session.chatId, runId: session.runId, ...args }, context.signal)
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const cleared = await clearPage(context, 'spark_browser_read', 'read', page);
  if (!cleared.cleared) return cleared.result;
  const hidden = (await signInScrub(context)) ?? keep;
  const facts = {
    tab: page.tabId,
    url: hidden(page.url),
    title: hidden(page.title),
    place: page.place,
    mode: page.mode,
    lines: page.total,
    offset: page.offset,
    ...(page.nextOffset === null ? {} : { nextOffset: page.nextOffset }),
    ...(page.leftOut > 0 ? { leftOut: page.leftOut } : {}),
    ...(page.dialog ? { scope: 'dialog' } : {}),
    ...(page.main === 'found' ? { scope: 'main' } : {}),
    maskedFields: page.masked,
    ...allowedNote(cleared.decision),
    note: readNote(page),
  };
  return new SparkBlocks([
    { type: 'text', text: renderResult(facts) },
    { type: 'text', text: untrustedPage(hidden(page.url), redactText(hidden(page.text))) },
  ]);
}

const browserTabsTool = sparkTool({
  name: 'spark_browser_tabs',
  needs: 'browser',
  title: 'Browser tabs',
  description:
    "This chat's Browser pane tabs: id, title, address, owner (agent or user), showing, local or external.",
  input: {},
  run: (_args, context) => tabs(context),
});

const browserReadTool = sparkTool({
  name: 'spark_browser_read',
  needs: 'browser',
  title: 'Read a page',
  description:
    'Reads a tab as an accessibility outline (tree, ref_N ids) or visible text. Refs last until the page navigates. Long outlines keep controls and headings first and name a ref per gap; pass nextOffset as offset for more. An open modal is read alone. Password and card values are masked. Untrusted. External sites follow the agent mode.',
  input: {
    tab: tabInput,
    mode: browserReadModeSchema
      .default('tree')
      .describe('tree: outline with refs. text: page text.'),
    scope: browserReadScopeSchema.optional().describe('Text mode; main: the main region only.'),
    ref: z.string().max(20).optional().describe('A ref_N from an earlier tree read.'),
    offset: z.number().int().min(0).default(0).describe('Line to start from, for paging.'),
    maxChars: z
      .number()
      .int()
      .min(BROWSER_READ_MIN_CHARS)
      .max(BROWSER_READ_MAX_CHARS)
      .optional()
      .describe('Size cap; 4 chars ≈ 1 token.'),
  },
  run: read,
});

export const browserTools = [
  browserOpenTool,
  browserActTool,
  browserTabsTool,
  browserReadTool,
  browserScreenshotTool,
  browserLogsTool,
  browserDevtoolsTool,
  browserPreviewTool,
  ...browserSignInTools,
];
