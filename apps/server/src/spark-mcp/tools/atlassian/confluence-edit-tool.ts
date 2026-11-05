import { z } from 'zod';
import {
  ATLASSIAN_BODY_MAX,
  ATLASSIAN_CARD_TEXT_MAX,
  CONFLUENCE_TITLE_MAX,
  atlassianConfirm,
  confluenceEditOpSchema,
  confluencePageIdSchema,
  type ConfluenceEditAction,
  type ConfluenceEditOp,
} from '@spark-outpost/contracts';
import type { ConfluencePage } from '../../../atlassian/confluence.ts';
import { openAtlassian, type AtlassianSession } from '../../../atlassian/session.ts';
import { ACTION_NOTE } from '../../actions/action-note.ts';
import { proposeAction } from '../../actions/confirm.ts';
import { ticketDepsFor } from '../../deps.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';

interface EditArgs {
  action: ConfluenceEditOp;
  pageId?: string | undefined;
  version?: number | undefined;
  space?: string | undefined;
  parentId?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
}

const card = (text: string) => text.slice(0, ATLASSIAN_CARD_TEXT_MAX);

export function versionMoved(pageId: string, read: number, now: number): string {
  return `Page ${pageId} is at version ${now} now, not ${read}: someone changed it after you read it. Nothing was saved. Read it again with spark_confluence and redo the change on the new text.`;
}

const spaceLabel = (page: ConfluencePage) =>
  page.space ? `${page.space.key} · ${page.space.name}` : null;

function pageRef(page: ConfluencePage): ConfluenceEditAction['page'] {
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    version: page.version,
    spaceId: page.spaceId,
    space: spaceLabel(page),
    parentId: page.parentId,
  };
}

function needBody(args: EditArgs): string {
  if (!args.body) throw new SparkToolError('Pass body (Markdown).');
  return args.body;
}

async function create(session: AtlassianSession, args: EditArgs): Promise<ConfluenceEditAction> {
  if (!args.space || !args.title) throw new SparkToolError('Pass space (its key) and title.');
  const body = needBody(args);
  const space = await session.confluence.spaceByKey(args.space);
  if (args.parentId) {
    const parent = await session.confluence.page(args.parentId);
    if (parent.spaceId !== space.id) {
      throw new SparkToolError(`Page ${args.parentId} is not in the space ${space.key}.`);
    }
  }
  return {
    action: 'confluence_edit',
    op: 'create',
    page: {
      id: null,
      title: args.title,
      url: null,
      version: null,
      spaceId: space.id,
      space: `${space.key} · ${space.name}`,
      parentId: args.parentId ?? null,
    },
    body,
    before: null,
    after: { title: args.title, text: card(body) },
  };
}

async function onPage(session: AtlassianSession, args: EditArgs): Promise<ConfluenceEditAction> {
  if (!args.pageId) throw new SparkToolError('Pass pageId.');
  const page = await session.confluence.page(args.pageId);
  const before = { title: page.title, text: card(page.text) };
  const action = { action: 'confluence_edit' as const, op: args.action, page: pageRef(page) };
  if (args.action === 'delete') return { ...action, body: null, before, after: null };
  if (args.action === 'comment') {
    const body = needBody(args);
    return { ...action, body, before: null, after: { title: page.title, text: card(body) } };
  }
  if (args.version === undefined) {
    throw new SparkToolError('Pass version: the page version you read with spark_confluence.');
  }
  if (args.version !== page.version) {
    throw new SparkToolError(versionMoved(page.id, args.version, page.version));
  }
  if (args.title === undefined && args.body === undefined) {
    throw new SparkToolError('Pass title, body or both.');
  }
  return {
    ...action,
    body: args.body ?? null,
    before,
    after: { title: args.title ?? page.title, text: card(args.body ?? page.text) },
  };
}

async function edit(context: SparkToolContext, args: EditArgs) {
  const session = await openAtlassian(ticketDepsFor(context.deps, context.scope), 'confluence');
  const action =
    args.action === 'create' ? await create(session, args) : await onPage(session, args);
  return proposeAction(context, action, { confirmName: atlassianConfirm(action) });
}

export const confluenceEditTool = sparkTool({
  name: 'spark_confluence_edit',
  needs: 'confluence',
  acts: true,
  title: 'Change Confluence',
  description: `Changes Confluence. create adds a page (space key, title, body, optional parentId); update replaces a page's title or body and needs the version you read: if the page moved on since, nothing is saved and you read it again; comment adds a footer comment; delete moves the page to the trash. body is Markdown. The card shows before and after. ${ACTION_NOTE}`,
  input: {
    action: confluenceEditOpSchema,
    pageId: confluencePageIdSchema.optional(),
    version: z.number().int().positive().optional(),
    space: z.string().trim().min(1).max(255).optional(),
    parentId: confluencePageIdSchema.optional(),
    title: z.string().trim().min(1).max(CONFLUENCE_TITLE_MAX).optional(),
    body: z.string().trim().min(1).max(ATLASSIAN_BODY_MAX).optional(),
  },
  run: (args, context) => edit(context, args),
});
