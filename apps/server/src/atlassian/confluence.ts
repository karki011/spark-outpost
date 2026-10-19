import { z } from 'zod';
import { failure, isOk } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';
import { atlassianClient, type AtlassianAccess } from './access.ts';
import { storageToText } from './confluence-format.ts';

export const CONFLUENCE = { name: 'Confluence', thing: 'page' };

const versionSchema = z.object({
  number: z.number().int(),
  createdAt: z.string().optional(),
  authorId: z.string().optional(),
});

const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().optional(),
  spaceId: z.string(),
  parentId: z.string().nullable().optional(),
  version: versionSchema,
  body: z.object({ storage: z.object({ value: z.string() }).optional() }).optional(),
  _links: z.object({ webui: z.string().optional() }).optional(),
});
type PageAnswer = z.infer<typeof pageSchema>;

const spaceSchema = z.object({ id: z.string(), key: z.string(), name: z.string() });
const spacesSchema = z.object({ results: z.array(spaceSchema) });

const commentsSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      version: versionSchema.optional(),
      body: z.object({ storage: z.object({ value: z.string() }).optional() }).optional(),
    }),
  ),
});

const searchSchema = z.object({
  results: z.array(
    z.object({
      content: z
        .object({
          id: z.string(),
          type: z.string(),
          title: z.string().optional(),
          space: z.object({ key: z.string() }).optional(),
        })
        .optional(),
      title: z.string().optional(),
      excerpt: z.string().optional(),
      url: z.string().optional(),
      lastModified: z.string().optional(),
    }),
  ),
  totalSize: z.number().optional(),
  _links: z.object({ next: z.string().optional() }).optional(),
});

export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string;
  space: { key: string; name: string } | null;
  parentId: string | null;
  version: number;
  updatedAt: string | null;
  storage: string;
  text: string;
  url: string;
}

export interface ConfluenceComment {
  id: string;
  authorId: string | null;
  createdAt: string | null;
  text: string;
}

export interface ConfluenceHit {
  id: string;
  type: string;
  title: string;
  space: string | null;
  excerpt: string;
  updatedAt: string | null;
  url: string | null;
}

export interface NewPage {
  spaceId: string;
  parentId: string | null;
  title: string;
  storage: string;
}

export interface PageUpdate {
  id: string;
  title: string;
  storage: string;
  version: number;
}

export class ConfluenceConflictError extends Error {}

const pagePath = (id: string) => `/wiki/api/v2/pages/${encodeURIComponent(id)}`;

function cursorOf(next: string | undefined): string | null {
  if (!next) return null;
  return new URL(next, 'https://atlassian.invalid').searchParams.get('cursor');
}

export function confluenceClient(access: AtlassianAccess, fetchImpl: typeof fetch) {
  const client = atlassianClient(access, fetchImpl, CONFLUENCE);
  const linkOf = (webui: string | undefined, id: string) =>
    webui
      ? `${access.siteUrl}/wiki${webui}`
      : `${access.siteUrl}/wiki/pages/viewpage.action?pageId=${id}`;

  async function spaceById(id: string) {
    const space = await client
      .call(
        spaceSchema,
        { method: 'GET', path: `/wiki/api/v2/spaces/${encodeURIComponent(id)}` },
        'reading the space',
      )
      .catch(() => null);
    return space ? { key: space.key, name: space.name } : null;
  }

  function pageOf(page: PageAnswer, space: ConfluencePage['space']): ConfluencePage {
    const storage = page.body?.storage?.value ?? '';
    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      space,
      parentId: page.parentId ?? null,
      version: page.version.number,
      updatedAt: page.version.createdAt ?? null,
      storage,
      text: storageToText(storage),
      url: linkOf(page._links?.webui, page.id),
    };
  }

  return {
    async search(cql: string, limit: number, cursor: string | null) {
      const params = new URLSearchParams({ cql, limit: String(limit) });
      if (cursor) params.set('cursor', cursor);
      const found = await client.call(
        searchSchema,
        { method: 'GET', path: `/wiki/rest/api/search?${params.toString()}` },
        'searching Confluence',
      );
      const hits: ConfluenceHit[] = found.results.flatMap((result) =>
        result.content
          ? [
              {
                id: result.content.id,
                type: result.content.type,
                title: result.content.title ?? result.title ?? '',
                space: result.content.space?.key ?? null,
                excerpt: storageToText(result.excerpt ?? '').slice(0, 300),
                updatedAt: result.lastModified ?? null,
                url: result.url ? `${access.siteUrl}/wiki${result.url}` : null,
              },
            ]
          : [],
      );
      return { hits, total: found.totalSize ?? null, cursor: cursorOf(found._links?.next) };
    },
    async page(id: string): Promise<ConfluencePage> {
      const page = await client.call(
        pageSchema,
        { method: 'GET', path: `${pagePath(id)}?body-format=storage` },
        `reading page ${id}`,
      );
      return pageOf(page, await spaceById(page.spaceId));
    },
    async comments(id: string, limit: number): Promise<ConfluenceComment[]> {
      const found = await client.call(
        commentsSchema,
        {
          method: 'GET',
          path: `${pagePath(id)}/footer-comments?body-format=storage&limit=${limit}`,
        },
        `reading the comments on page ${id}`,
      );
      return found.results.map((comment) => ({
        id: comment.id,
        authorId: comment.version?.authorId ?? null,
        createdAt: comment.version?.createdAt ?? null,
        text: storageToText(comment.body?.storage?.value ?? ''),
      }));
    },
    async spaceByKey(key: string) {
      const found = await client.call(
        spacesSchema,
        { method: 'GET', path: `/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1` },
        `finding the space ${key}`,
      );
      const space = found.results[0];
      if (!space) {
        throw new TicketApiError(404, `Confluence has no space ${key} that this account can see.`);
      }
      return space;
    },
    async create(page: NewPage): Promise<ConfluencePage> {
      const created = await client.call(
        pageSchema,
        {
          method: 'POST',
          path: '/wiki/api/v2/pages',
          body: {
            spaceId: page.spaceId,
            status: 'current',
            title: page.title,
            ...(page.parentId ? { parentId: page.parentId } : {}),
            body: { representation: 'storage', value: page.storage },
          },
        },
        'creating the page',
      );
      return pageOf(created, null);
    },
    async update(update: PageUpdate): Promise<ConfluencePage> {
      const answer = await client.raw({
        method: 'PUT',
        path: pagePath(update.id),
        body: {
          id: update.id,
          status: 'current',
          title: update.title,
          body: { representation: 'storage', value: update.storage },
          version: { number: update.version + 1, message: 'Edited by an agent in Spark Outpost' },
        },
      });
      if (answer.status === 409) {
        throw new ConfluenceConflictError(
          `Page ${update.id} changed in Confluence since version ${update.version}. Nothing was saved; read it again.`,
        );
      }
      if (!isOk(answer)) {
        throw failure(CONFLUENCE.name, `saving page ${update.id}`, answer, CONFLUENCE.thing);
      }
      const parsed = pageSchema.safeParse(answer.data);
      if (!parsed.success) {
        throw new TicketApiError(
          502,
          'Confluence sent an unexpected answer while saving the page.',
        );
      }
      return pageOf(parsed.data, null);
    },
    async comment(pageId: string, storage: string): Promise<string> {
      const created = await client.call(
        z.object({ id: z.string() }),
        {
          method: 'POST',
          path: '/wiki/api/v2/footer-comments',
          body: { pageId, body: { representation: 'storage', value: storage } },
        },
        `commenting on page ${pageId}`,
      );
      return created.id;
    },
    async remove(id: string): Promise<void> {
      await client.call(null, { method: 'DELETE', path: pagePath(id) }, `deleting page ${id}`);
    },
  };
}

export type ConfluenceClient = ReturnType<typeof confluenceClient>;
