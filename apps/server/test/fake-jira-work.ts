import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FakeJiraIssue } from './fake-jira.ts';
import { agileRoute, type FakeAgile } from './fake-jira-agile.ts';

type Send = (res: ServerResponse, status: number, body?: unknown) => void;

export interface FakeWorklog {
  id: string;
  author: string;
  timeSpent: string;
  started: string;
  updated: string;
  comment: unknown;
}

export interface FakeWork {
  links: { id: string; type: string; inward: string; outward: string }[];
  watchers: Record<string, string[]>;
  votes: Record<string, boolean>;
  worklogs: Record<string, FakeWorklog[]>;
  attachments: { id: string; key: string; filename: string; mimeType: string; data: Buffer }[];
  versions: {
    id: string;
    project: string;
    name: string;
    released: boolean;
    releaseDate?: string;
  }[];
  agile: FakeAgile;
  mediaAuth: (string | null)[];
}

export const LINK_TYPES = [
  { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '2', name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
  { id: '3', name: 'Relates', inward: 'relates to', outward: 'relates to' },
];

export const STORY_POINTS = 'customfield_10016';

const people: Record<string, string> = { 'acc-1': 'Alex Example', 'acc-2': 'Jordan Lee' };
const PROJECT_IDS: Record<string, string> = { WEB: '10000', API: '10001' };

export function fakeWork(): FakeWork {
  return {
    links: [],
    watchers: {},
    votes: {},
    worklogs: {},
    attachments: [],
    versions: [{ id: '20000', project: 'WEB', name: '1.0', released: false }],
    agile: { sprints: [], issueSprints: {}, ranks: [] },
    mediaAuth: [],
  };
}

const user = (id: string | undefined) =>
  id ? { accountId: id, displayName: people[id] ?? id } : null;
const named = (items: unknown) => (Array.isArray(items) ? items : []);

export function editMeta(project: string) {
  const option = (name: string) => ({ id: name.toLowerCase(), name });
  return {
    fields: {
      summary: { name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
      priority: {
        name: 'Priority',
        required: false,
        schema: { type: 'priority' },
        allowedValues: ['High', 'Medium', 'Low'].map(option),
      },
      components: {
        name: 'Components',
        required: false,
        schema: { type: 'array', items: 'component' },
        allowedValues: [
          { id: '1', name: 'Frontend' },
          { id: '2', name: 'Backend' },
        ],
      },
      fixVersions: {
        name: 'Fix versions',
        required: false,
        schema: { type: 'array', items: 'version' },
        allowedValues: [{ id: '20000', name: '1.0' }],
      },
      duedate: { name: 'Due date', required: false, schema: { type: 'date' } },
      assignee: { name: 'Assignee', required: false, schema: { type: 'user' } },
      [STORY_POINTS]: {
        name: 'Story point estimate',
        required: false,
        schema: {
          type: 'number',
          custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
        },
      },
      customfield_10015: {
        name: 'Start date',
        required: false,
        schema: {
          type: 'date',
          custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker',
        },
      },
      ...(project === 'API'
        ? {}
        : {
            labels: { name: 'Labels', required: false, schema: { type: 'array', items: 'string' } },
          }),
    },
  };
}

export function workView(item: FakeJiraIssue, work: FakeWork) {
  const extra = item.extra ?? {};
  return {
    components: named(extra.components).map((entry) => ({
      name: (entry as { id: string }).id === '1' ? 'Frontend' : 'Backend',
    })),
    fixVersions: named(extra.fixVersions),
    [STORY_POINTS]: extra[STORY_POINTS] ?? null,
    timetracking: extra.timetracking ?? {},
    resolution: extra.resolution ?? null,
    issuelinks: work.links
      .filter((link) => link.inward === item.key || link.outward === item.key)
      .map((link) => {
        const type = LINK_TYPES.find((entry) => entry.name === link.type)!;
        return link.outward === item.key
          ? { id: link.id, type, outwardIssue: { key: link.inward } }
          : { id: link.id, type, inwardIssue: { key: link.outward } };
      }),
    attachment: work.attachments
      .filter((file) => file.key === item.key)
      .map((file) => ({
        id: file.id,
        filename: file.filename,
        size: file.data.length,
        mimeType: file.mimeType,
      })),
    watches: { watchCount: (work.watchers[item.key] ?? []).length },
    votes: { votes: work.votes[item.key] ? 1 : 0 },
  };
}

export function applyWork(item: FakeJiraIssue, fields: Record<string, unknown>, update: unknown) {
  const extra = (item.extra ??= {});
  for (const name of [
    'components',
    'fixVersions',
    'duedate',
    STORY_POINTS,
    'customfield_10015',
    'timetracking',
  ]) {
    if (name in fields) extra[name] = fields[name];
  }
  if (typeof fields.duedate === 'string') item.duedate = fields.duedate;
  if ('assignee' in fields)
    item.assignee = (fields.assignee as { accountId?: string } | null)?.accountId ?? null;
  if ('reporter' in fields)
    item.reporter = (fields.reporter as { accountId?: string } | null)?.accountId ?? null;
  const parent = fields.parent as Record<string, unknown> | undefined;
  if (parent && Object.keys(parent).length === 0) item.parent = null;
  const labels =
    (update as { labels?: { add?: string; remove?: string }[] } | undefined)?.labels ?? [];
  for (const op of labels) {
    if (op.add && !item.labels.includes(op.add)) item.labels.push(op.add);
    if (op.remove) item.labels = item.labels.filter((label) => label !== op.remove);
  }
}

async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

const json = async (req: IncomingMessage) => {
  const text = (await rawBody(req)).toString('utf8');
  try {
    return JSON.parse(text || '{}') as unknown;
  } catch {
    return {};
  }
};

const ISSUE_SUB =
  /^\/rest\/api\/3\/issue\/([^/]+)\/(editmeta|watchers|votes|worklog|attachments)(?:\/(\d+))?$/;
const now = () => new Date().toISOString().replace('Z', '+0000');

async function issueSub(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  item: FakeJiraIssue,
  sub: string,
  id: string | undefined,
  work: FakeWork,
  send: Send,
) {
  const { key } = item;
  if (sub === 'editmeta') return send(res, 200, editMeta(key.split('-')[0]!));
  if (sub === 'watchers') {
    const list = (work.watchers[key] ??= []);
    if (req.method === 'GET')
      return send(res, 200, { watchCount: list.length, watchers: list.map(user) });
    if (req.method === 'POST') list.push(String(await json(req)));
    else work.watchers[key] = list.filter((entry) => entry !== url.searchParams.get('accountId'));
    return send(res, 204);
  }
  if (sub === 'votes') {
    if (req.method === 'GET')
      return send(res, 200, { votes: work.votes[key] ? 1 : 0, hasVoted: !!work.votes[key] });
    work.votes[key] = req.method === 'POST';
    return send(res, 204);
  }
  if (sub === 'attachments') {
    const body = (await rawBody(req)).toString('latin1');
    const filename = /filename="([^"]+)"/.exec(body)?.[1] ?? 'file';
    const fileId = String(30000 + work.attachments.length);
    work.attachments.push({
      id: fileId,
      key,
      filename,
      mimeType: 'text/plain',
      data: Buffer.from(body.split('\r\n\r\n')[1]?.split('\r\n--')[0] ?? ''),
    });
    return send(res, 200, [{ id: fileId, filename }]);
  }
  const logs = (work.worklogs[key] ??= []);
  const log = logs.find((entry) => entry.id === id);
  const view = (entry: FakeWorklog) => ({
    id: entry.id,
    author: user(entry.author),
    timeSpent: entry.timeSpent,
    started: entry.started,
    updated: entry.updated,
    comment: entry.comment,
  });
  if (!id && req.method === 'GET')
    return send(res, 200, { worklogs: logs.map(view), total: logs.length });
  if (!id && req.method === 'POST') {
    const body = (await json(req)) as Record<string, unknown>;
    const created = {
      id: String(40000 + logs.length),
      author: 'acc-1',
      timeSpent: String(body.timeSpent),
      started: String(body.started ?? now()),
      updated: now(),
      comment: body.comment ?? null,
    };
    logs.push(created);
    return send(res, 201, view(created));
  }
  if (!log) return send(res, 404, { errorMessages: ['Worklog not found.'] });
  if (req.method === 'GET') return send(res, 200, view(log));
  if (req.method === 'DELETE') {
    work.worklogs[key] = logs.filter((entry) => entry !== log);
    return send(res, 204);
  }
  const body = (await json(req)) as Record<string, unknown>;
  if (typeof body.timeSpent === 'string') log.timeSpent = body.timeSpent;
  if (body.comment !== undefined) log.comment = body.comment;
  log.updated = new Date(Date.parse(log.updated.replace('+0000', 'Z')) + 60_000)
    .toISOString()
    .replace('Z', '+0000');
  return send(res, 200, view(log));
}

async function siteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  work: FakeWork,
  send: Send,
): Promise<boolean> {
  const path = url.pathname;
  if (path === '/rest/api/3/issueLinkType')
    return (send(res, 200, { issueLinkTypes: LINK_TYPES }), true);
  if (path === '/rest/api/3/issueLink' && req.method === 'POST') {
    const body = (await json(req)) as {
      type: { name: string };
      inwardIssue: { key: string };
      outwardIssue: { key: string };
    };
    work.links.push({
      id: String(50000 + work.links.length),
      type: body.type.name,
      inward: body.inwardIssue.key,
      outward: body.outwardIssue.key,
    });
    return (send(res, 201), true);
  }
  const link = /^\/rest\/api\/3\/issueLink\/(\d+)$/.exec(path);
  if (link) {
    const found = work.links.find((entry) => entry.id === link[1]);
    if (!found) return (send(res, 404, { errorMessages: ['No issue link with id exists.'] }), true);
    if (req.method === 'DELETE') work.links = work.links.filter((entry) => entry !== found);
    const type = LINK_TYPES.find((entry) => entry.name === found.type)!;
    send(res, req.method === 'DELETE' ? 204 : 200, {
      id: found.id,
      type,
      inwardIssue: { key: found.inward },
      outwardIssue: { key: found.outward },
    });
    return true;
  }
  if (path === '/rest/api/3/user/search' || path === '/rest/api/3/user/assignable/search') {
    const query = (url.searchParams.get('query') ?? '').toLowerCase();
    const found = Object.entries(people).filter(([, name]) => name.toLowerCase().includes(query));
    return (
      send(
        res,
        200,
        found.map(([accountId, displayName]) => ({
          accountId,
          displayName,
          active: true,
          accountType: 'atlassian',
        })),
      ),
      true
    );
  }
  if (path === '/rest/api/3/user') {
    const id = url.searchParams.get('accountId') ?? '';
    if (!people[id]) return (send(res, 404, { errorMessages: ['User does not exist.'] }), true);
    return (send(res, 200, { accountId: id, displayName: people[id], active: true }), true);
  }
  const attachment = /^\/rest\/api\/3\/attachment\/(content\/)?(\d+)$/.exec(path);
  if (attachment) {
    const file = work.attachments.find((entry) => entry.id === attachment[2]);
    if (!file) return (send(res, 404, { errorMessages: ['Attachment not found.'] }), true);
    if (attachment[1]) {
      res.writeHead(303, { location: `/media/${file.id}` });
      res.end();
      return true;
    }
    if (req.method === 'DELETE')
      work.attachments = work.attachments.filter((entry) => entry !== file);
    send(res, req.method === 'DELETE' ? 204 : 200, {
      id: file.id,
      filename: file.filename,
      size: file.data.length,
      mimeType: file.mimeType,
    });
    return true;
  }
  return projectRoute(req, res, url, work, send);
}

async function projectRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  work: FakeWork,
  send: Send,
): Promise<boolean> {
  const path = url.pathname;
  if (path === '/rest/api/3/project/search') {
    return (
      send(res, 200, {
        values: Object.entries(PROJECT_IDS).map(([key, id]) => ({
          id,
          key,
          name: `${key} project`,
          style: 'classic',
        })),
      }),
      true
    );
  }
  const project = /^\/rest\/api\/3\/project\/([A-Z]+)(?:\/(components|versions))?$/.exec(path);
  if (project && PROJECT_IDS[project[1]!]) {
    const key = project[1]!;
    if (project[2] === 'components')
      return (
        send(res, 200, [
          { id: '1', name: 'Frontend' },
          { id: '2', name: 'Backend' },
        ]),
        true
      );
    if (project[2] === 'versions')
      return (
        send(
          res,
          200,
          work.versions.filter((entry) => entry.project === key),
        ),
        true
      );
    return (
      send(res, 200, { id: PROJECT_IDS[key], key, name: `${key} project`, style: 'classic' }),
      true
    );
  }
  if (path === '/rest/api/3/version' && req.method === 'POST') {
    const body = (await json(req)) as { projectId: number; name: string };
    const key =
      Object.entries(PROJECT_IDS).find(([, id]) => Number(id) === body.projectId)?.[0] ?? 'WEB';
    const created = {
      id: String(20000 + work.versions.length),
      project: key,
      name: body.name,
      released: false,
    };
    work.versions.push(created);
    return (send(res, 201, created), true);
  }
  const version = /^\/rest\/api\/3\/version\/(\d+)$/.exec(path);
  if (version) {
    const found = work.versions.find((entry) => entry.id === version[1]);
    if (!found) return (send(res, 404, { errorMessages: ['Version not found.'] }), true);
    if (req.method === 'PUT') Object.assign(found, (await json(req)) as object);
    return (send(res, 200, found), true);
  }
  return agileRoute(req, res, url, work.agile, send, json);
}

export function mediaRoute(req: IncomingMessage, res: ServerResponse, url: URL, work: FakeWork) {
  work.mediaAuth.push(req.headers.authorization ?? null);
  const file = work.attachments.find((entry) => url.pathname === `/media/${entry.id}`);
  res.writeHead(file ? 200 : 404, { 'content-type': file?.mimeType ?? 'text/plain' });
  res.end(file?.data ?? 'missing');
}

export async function workRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  issues: FakeJiraIssue[],
  work: FakeWork,
  send: Send,
): Promise<boolean> {
  const sub = ISSUE_SUB.exec(url.pathname);
  if (!sub) return siteRoute(req, res, url, work, send);
  const item = issues.find((entry) => entry.key === decodeURIComponent(sub[1]!));
  if (!item) return (send(res, 404, { errorMessages: ['Issue does not exist.'] }), true);
  await issueSub(req, res, url, item, sub[2]!, sub[3], work, send);
  return true;
}
