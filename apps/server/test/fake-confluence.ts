import type { IncomingMessage, ServerResponse } from 'node:http';
import { JIRA_EMAIL, JIRA_ME, JIRA_TOKEN } from './fake-jira.ts';

export interface FakeConfluencePage {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  storage: string;
  version: number;
  status: 'current' | 'trashed';
}

export interface FakeConfluenceComment {
  id: string;
  pageId: string;
  storage: string;
  authorId: string;
}

export interface FakeConfluence {
  reachable: boolean;
  pages: FakeConfluencePage[];
  comments: FakeConfluenceComment[];
  spaces: { id: string; key: string; name: string }[];
  faults: Map<string, number>;
  cql: string[];
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const EXPECTED_AUTH = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;
const PAGE = /^\/wiki\/api\/v2\/pages\/(\d+)(\/footer-comments)?$/;
const SPACE = /^\/wiki\/api\/v2\/spaces\/(\d+)$/;

function send(res: ServerResponse, status: number, body?: unknown, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  try {
    return JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function seedPages(): FakeConfluencePage[] {
  return [
    {
      id: '9001',
      spaceId: '501',
      parentId: null,
      title: 'Release checklist',
      storage:
        '<h2>Before the release</h2><ul><li>Run <strong>pnpm check</strong></li><li>Write notes</li></ul><p>Ask &amp; wait for review.</p>',
      version: 3,
      status: 'current',
    },
    {
      id: '9002',
      spaceId: '501',
      parentId: '9001',
      title: 'Rollback plan',
      storage: '<p>Revert the deploy.</p>',
      version: 1,
      status: 'current',
    },
  ];
}

const bodyValue = (body: unknown) =>
  typeof body === 'object' && body !== null
    ? String((body as { value?: unknown }).value ?? '')
    : '';

export function fakeConfluence(): FakeConfluence {
  const state: Omit<FakeConfluence, 'handle'> = {
    reachable: true,
    pages: seedPages(),
    comments: [],
    spaces: [{ id: '501', key: 'ENG', name: 'Engineering' }],
    faults: new Map(),
    cql: [],
  };
  const pageView = (page: FakeConfluencePage, withBody: boolean) => ({
    id: page.id,
    status: page.status,
    title: page.title,
    spaceId: page.spaceId,
    parentId: page.parentId,
    version: { number: page.version, createdAt: '2026-10-01T10:00:00.000Z', authorId: JIRA_ME },
    ...(withBody ? { body: { storage: { value: page.storage, representation: 'storage' } } } : {}),
    _links: { webui: `/spaces/ENG/pages/${page.id}` },
  });
  const current = (id: string) =>
    state.pages.find((page) => page.id === id && page.status === 'current');

  function search(res: ServerResponse, url: URL) {
    const cql = url.searchParams.get('cql') ?? '';
    state.cql.push(cql);
    const text = /(?:text|title) ~ "([^"]+)"/.exec(cql)?.[1]?.toLowerCase() ?? '';
    const found = state.pages.filter(
      (page) =>
        page.status === 'current' &&
        (!text || `${page.title} ${page.storage}`.toLowerCase().includes(text)),
    );
    return send(res, 200, {
      results: found.map((page) => ({
        content: { id: page.id, type: 'page', title: page.title, space: { key: 'ENG' } },
        title: page.title,
        excerpt: page.storage.slice(0, 80),
        url: `/spaces/ENG/pages/${page.id}`,
        lastModified: '2026-10-01T10:00:00.000Z',
      })),
      totalSize: found.length,
      _links: {},
    });
  }

  async function createPage(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    if (!state.spaces.some((space) => space.id === body.spaceId)) {
      return send(res, 400, { errors: [{ title: 'Space not found' }] });
    }
    const page: FakeConfluencePage = {
      id: String(9001 + state.pages.length),
      spaceId: String(body.spaceId),
      parentId: typeof body.parentId === 'string' ? body.parentId : null,
      title: String(body.title),
      storage: bodyValue(body.body),
      version: 1,
      status: 'current',
    };
    state.pages.push(page);
    return send(res, 200, pageView(page, true));
  }

  async function pageRoute(req: IncomingMessage, res: ServerResponse, id: string, sub?: string) {
    const page = current(id);
    if (!page) return send(res, 404, { errors: [{ title: 'Page not found' }] });
    if (sub && req.method === 'GET') {
      const comments = state.comments.filter((comment) => comment.pageId === id);
      return send(res, 200, {
        results: comments.map((comment) => ({
          id: comment.id,
          version: { number: 1, authorId: comment.authorId, createdAt: '2026-10-02T10:00:00Z' },
          body: { storage: { value: comment.storage } },
        })),
      });
    }
    if (req.method === 'GET') return send(res, 200, pageView(page, true));
    if (req.method === 'DELETE') {
      page.status = 'trashed';
      return send(res, 204);
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const version = (body.version as { number?: number } | undefined)?.number;
      if (version !== page.version + 1) {
        return send(res, 409, { errors: [{ title: 'Version must be incremented' }] });
      }
      page.title = String(body.title);
      page.storage = bodyValue(body.body);
      page.version = version;
      return send(res, 200, pageView(page, true));
    }
    return send(res, 405, { errors: [{ title: 'Method not allowed' }] });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname;
    if (path === '/wiki/rest/api/user/current') {
      return send(res, 200, { accountId: JIRA_ME, displayName: 'Alex Example', email: JIRA_EMAIL });
    }
    if (path === '/wiki/rest/api/search') return search(res, url);
    if (path === '/wiki/api/v2/spaces') {
      const keys = url.searchParams.get('keys');
      const spaces = keys ? state.spaces.filter((space) => space.key === keys) : state.spaces;
      return send(res, 200, { results: spaces.slice(0, 1) });
    }
    const space = SPACE.exec(path);
    if (space) {
      const found = state.spaces.find((entry) => entry.id === space[1]);
      return found ? send(res, 200, found) : send(res, 404, { errors: [{ title: 'No space' }] });
    }
    if (path === '/wiki/api/v2/pages' && req.method === 'POST') return createPage(req, res);
    if (path === '/wiki/api/v2/footer-comments' && req.method === 'POST') {
      const body = await readJson(req);
      if (!current(String(body.pageId))) return send(res, 404, { errors: [{ title: 'No page' }] });
      const comment = {
        id: String(7001 + state.comments.length),
        pageId: String(body.pageId),
        storage: bodyValue(body.body),
        authorId: JIRA_ME,
      };
      state.comments.push(comment);
      return send(res, 200, { id: comment.id });
    }
    const page = PAGE.exec(path);
    if (page) return pageRoute(req, res, page[1]!, page[2]);
    return send(res, 404, { errors: [{ title: 'Not found' }] });
  }

  return Object.assign(state, {
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (!state.reachable || req.headers.authorization !== EXPECTED_AUTH) {
        return send(res, 401, { message: 'Unauthorized; scope does not match' });
      }
      const url = new URL(req.url ?? '/', 'http://fake');
      const key = `${req.method} ${url.pathname}`;
      const fault = state.faults.get(key);
      if (fault) {
        state.faults.delete(key);
        return send(
          res,
          fault,
          { errors: [{ title: `Fake fault ${fault}` }] },
          { 'retry-after': '7' },
        );
      }
      return route(req, res, url);
    },
  });
}

export function atlassianHandler(
  jira: { handle(req: IncomingMessage, res: ServerResponse): Promise<void> },
  confluence: FakeConfluence,
) {
  return (req: IncomingMessage, res: ServerResponse) =>
    (req.url ?? '').startsWith('/wiki/') ? confluence.handle(req, res) : jira.handle(req, res);
}
