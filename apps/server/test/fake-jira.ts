import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  devDetailBody,
  devSummaryBody,
  type DevStatusMode,
  type FakeDevelopment,
} from './fake-jira-dev.ts';
import { commentView, jiraEditRoute, type FakeJiraComment } from './fake-jira-edits.ts';

export const JIRA_EMAIL = 'alex@example.test';
export const JIRA_TOKEN = 'jira_fake_token_0123456789';
export const JIRA_ME = 'acc-1';

export const jiraPeople: Record<string, string> = {
  'acc-1': 'Alex Example',
  'acc-2': 'Jordan Lee',
};

type Category = 'new' | 'indeterminate' | 'done';

export interface FakeJiraIssue {
  key: string;
  summary: string;
  description: unknown;
  status: string;
  updated: string;
  assignee: string | null;
  priority: string;
  duedate: string | null;
  resolutiondate: string | null;
  reporter: string | null;
  created: string | null;
  labels: string[];
  comments: FakeJiraComment[];
  remoteLinks: { globalId: string; url: string; title: string }[];
  subtasks: string[];
}

export interface FakeJira {
  workflows: Record<string, Record<string, Category>>;
  issues: FakeJiraIssue[];
  development: Record<string, FakeDevelopment>;
  devStatus: { mode: DevStatusMode; requests: string[] };
  jql: string[];
  denyAssign: Set<string>;
  closedTransitions: Set<string>;
  faults: Map<string, number>;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const adf = (...blocks: unknown[]) => ({ type: 'doc', version: 1, content: blocks });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const heading = (text: string) => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
});
const bullets = (...items: string[]) => ({
  type: 'bulletList',
  content: items.map((text) => ({ type: 'listItem', content: [paragraph(text)] })),
});

function seedIssues(): FakeJiraIssue[] {
  const base = {
    description: null,
    status: 'To Do',
    updated: '2026-09-20T10:00:00.000+0000',
    assignee: JIRA_ME,
    priority: 'Medium',
    duedate: null,
    resolutiondate: null,
    reporter: 'acc-2',
    created: '2026-09-18T09:00:00.000+0000',
    labels: ['frontend'],
    comments: [],
    remoteLinks: [],
    subtasks: [],
  };
  return [
    {
      ...base,
      key: 'WEB-418',
      summary: 'Export the usage table as CSV',
      description: adf(
        paragraph('People want the usage table in a spreadsheet.'),
        heading('Acceptance criteria'),
        bullets('A Download CSV button', 'Columns match the table'),
      ),
      updated: '2026-09-27T12:00:00.000+0000',
      comments: [
        {
          author: 'Sam',
          body: adf(paragraph('Include cost too.')),
          created: '2026-09-26T08:00:00.000+0000',
        },
      ],
      subtasks: ['WEB-419'],
    },
    {
      ...base,
      key: 'WEB-419',
      summary: 'CSV header row',
      status: 'In Progress',
      reporter: null,
      created: null,
    },
    {
      ...base,
      key: 'WEB-420',
      summary: 'Shipped last sprint',
      status: 'Done',
      resolutiondate: '2026-09-26T09:00:00.000+0000',
    },
    { ...base, key: 'WEB-437', summary: 'Uploads over 2 GB fail', assignee: 'acc-2' },
    { ...base, key: 'API-95', summary: 'Resumable uploads', assignee: null },
    {
      ...base,
      key: 'API-77',
      summary: 'Rate limit the search endpoint',
      updated: '2026-09-25T12:00:00.000+0000',
    },
  ];
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
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

const DEV_STATUS = /^\/rest\/dev-status\/latest\/issue\/(summary|detail)$/;
const EXPECTED_AUTH = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;
const PROJECT_STATUSES = /^\/rest\/api\/3\/project\/([^/]+)\/statuses$/;
const ISSUE =
  /^\/rest\/api\/3\/issue\/([^/]+)(?:\/(remotelink|transitions|comment|assignee))?(?:\/(\d+))?$/;

export function fakeJira(): FakeJira {
  const workflows: Record<string, Record<string, Category>> = {
    WEB: {
      'To Do': 'new',
      'In Progress': 'indeterminate',
      'Code Review': 'indeterminate',
      Done: 'done',
    },
    API: { 'To Do': 'new', 'Waiting for QA': 'indeterminate', Done: 'done' },
  };
  const issues = seedIssues();
  const development: Record<string, FakeDevelopment> = {};
  const devStatus: FakeJira['devStatus'] = { mode: 'ok', requests: [] };
  const issueId = (item: FakeJiraIssue) => String(10_000 + issues.indexOf(item));
  const jql: string[] = [];
  const denyAssign = new Set<string>();
  const closedTransitions = new Set<string>();
  const faults = new Map<string, number>();

  const projectOf = (item: FakeJiraIssue) => item.key.split('-')[0]!;
  const categoryOf = (item: FakeJiraIssue) => workflows[projectOf(item)]![item.status]!;
  const statusField = (item: FakeJiraIssue) => ({
    name: item.status,
    statusCategory: { key: categoryOf(item) },
  });

  function fields(item: FakeJiraIssue) {
    return {
      summary: item.summary,
      status: statusField(item),
      updated: item.updated,
      priority: { name: item.priority },
      project: { key: projectOf(item) },
      customfield_10020: [{ name: 'Sprint 41', state: 'active' }],
      description: item.description,
      assignee: item.assignee
        ? { accountId: item.assignee, displayName: jiraPeople[item.assignee] ?? item.assignee }
        : null,
      duedate: item.duedate,
      resolutiondate: item.resolutiondate,
      reporter: item.reporter
        ? { accountId: item.reporter, displayName: jiraPeople[item.reporter] ?? item.reporter }
        : null,
      ...(item.created ? { created: item.created } : {}),
      labels: item.labels,
      comment: {
        comments: item.comments
          .map((comment, index) => ({ comment, index }))
          .filter(({ comment }) => comment.created !== 'deleted')
          .map(({ comment, index }) => commentView(comment, index, jiraPeople)),
      },
      subtasks: item.subtasks.map((key) => {
        const sub = issues.find((entry) => entry.key === key)!;
        return { key, fields: { summary: sub.summary, status: statusField(sub) } };
      }),
    };
  }

  function assigneeMatches(item: FakeJiraIssue, query: string) {
    if (query.includes('assignee != currentUser()')) {
      return item.assignee !== null && item.assignee !== JIRA_ME;
    }
    if (query.includes('assignee = currentUser()')) return item.assignee === JIRA_ME;
    if (query.includes('assignee is EMPTY')) return item.assignee === null;
    return true;
  }

  function search(query: string) {
    jql.push(query);
    const project = /project = "([^"]+)"/.exec(query)?.[1];
    const text = /text ~ "([^"]+)"/.exec(query)?.[1]?.toLowerCase();
    const key = /key = "([^"]+)"/.exec(query)?.[1];
    const wantDone = query.includes('statusCategory = Done');
    return issues.filter((item) => {
      if (!assigneeMatches(item, query)) return false;
      if (key && item.key !== key) return false;
      if ((categoryOf(item) === 'done') !== wantDone) return false;
      if (project && projectOf(item) !== project) return false;
      return !text || item.summary.toLowerCase().includes(text);
    });
  }

  function transitions(item: FakeJiraIssue) {
    return Object.entries(workflows[projectOf(item)]!)
      .filter(([name]) => name !== item.status)
      .filter(([name]) => !closedTransitions.has(`${projectOf(item)}:${item.status}>${name}`))
      .map(([name, key], index) => ({
        id: String(index + 11),
        name: `Move to ${name}`,
        to: { name, statusCategory: { key } },
      }));
  }

  async function issueRoute(
    req: IncomingMessage,
    res: ServerResponse,
    key: string,
    sub: string | undefined,
    commentId: string | undefined,
  ) {
    const item = issues.find((entry) => entry.key === decodeURIComponent(key));
    if (!item)
      return send(res, 404, {
        errorMessages: ['Issue does not exist or you do not have permission to see it.'],
      });
    if (!sub && req.method === 'GET')
      return send(res, 200, { id: issueId(item), key: item.key, fields: fields(item) });
    if (sub === 'remotelink' && req.method === 'GET') {
      return send(
        res,
        200,
        item.remoteLinks.map((link) => ({ object: { url: link.url, title: link.title } })),
      );
    }
    const handled = await jiraEditRoute({
      req,
      res,
      url: new URL(req.url ?? '/', 'http://fake'),
      item,
      sub,
      commentId,
      issues,
      body: () => readJson(req),
      send,
      people: jiraPeople,
    });
    if (handled) return;
    const body = await readJson(req);
    if (sub === 'assignee' && req.method === 'PUT') {
      if (denyAssign.has(projectOf(item))) {
        return send(res, 403, { errorMessages: ['You do not have permission to assign issues.'] });
      }
      item.assignee = typeof body.accountId === 'string' ? body.accountId : null;
      return send(res, 204);
    }
    if (sub === 'remotelink') {
      const object = body.object as { url: string; title: string };
      const existing = item.remoteLinks.find((link) => link.globalId === body.globalId);
      if (existing) Object.assign(existing, object);
      else item.remoteLinks.push({ globalId: String(body.globalId), ...object });
      return send(res, existing ? 200 : 201, { id: item.remoteLinks.length });
    }
    if (sub === 'transitions' && req.method === 'GET')
      return send(res, 200, { transitions: transitions(item) });
    if (sub === 'transitions') {
      const id = (body.transition as { id?: string } | undefined)?.id;
      const next = transitions(item).find((transition) => transition.id === id);
      if (!next) return send(res, 400, { errorMessages: ['Transition is not valid.'] });
      item.status = next.to.name;
      return send(res, 204);
    }
    if (sub === 'comment') {
      item.comments.push({
        author: 'Alex Example',
        authorId: JIRA_ME,
        body: body.body,
        created: new Date().toISOString(),
      });
      return send(res, 201, { id: String(999 + item.comments.length) });
    }
    send(res, 405, { errorMessages: ['Method not allowed'] });
  }

  function createIssue(res: ServerResponse, body: Record<string, unknown>) {
    const fields = body.fields as {
      project: { key: string };
      summary: string;
      description: unknown;
      priority?: { name: string };
      labels?: string[];
      assignee?: { accountId: string };
    };
    if (!workflows[fields.project.key]) {
      return send(res, 400, { errors: { project: 'valid project is required' } });
    }
    const number = issues.filter((item) => projectOf(item) === fields.project.key).length + 100;
    const key = `${fields.project.key}-${number}`;
    issues.push({
      key,
      summary: fields.summary,
      description: fields.description,
      status: Object.keys(workflows[fields.project.key]!)[0]!,
      updated: new Date().toISOString(),
      assignee: fields.assignee?.accountId ?? null,
      priority: fields.priority?.name ?? 'Medium',
      duedate: null,
      resolutiondate: null,
      reporter: JIRA_ME,
      created: new Date().toISOString(),
      labels: fields.labels ?? [],
      comments: [],
      remoteLinks: [],
      subtasks: [],
    });
    return send(res, 201, { id: String(issues.length), key, self: `/rest/api/3/issue/${key}` });
  }

  function projectStatuses(res: ServerResponse, key: string) {
    const workflow = workflows[key];
    if (!workflow) return send(res, 404, { errorMessages: ['No project could be found.'] });
    const statuses = Object.entries(workflow).map(([name, category]) => ({
      name,
      statusCategory: { key: category },
    }));
    return send(res, 200, [{ name: 'Task', statuses }]);
  }

  function devStatusRoute(res: ServerResponse, url: URL, kind: string) {
    devStatus.requests.push(`${kind}:${url.searchParams.toString()}`);
    if (devStatus.mode === 'forbidden') return send(res, 403, { errorMessages: ['Forbidden'] });
    if (devStatus.mode === 'missing') return send(res, 404, { errorMessages: ['Not found'] });
    if (devStatus.mode === 'malformed') return send(res, 200, { summary: 'none', detail: {} });
    const item = issues.find((entry) => issueId(entry) === url.searchParams.get('issueId'));
    const dev = (item && development[item.key]) ?? {};
    if (kind === 'summary') return send(res, 200, devSummaryBody(dev));
    return send(
      res,
      200,
      devDetailBody(dev, url.searchParams.get('applicationType'), url.searchParams.get('dataType')),
    );
  }

  return {
    workflows,
    issues,
    development,
    devStatus,
    jql,
    denyAssign,
    closedTransitions,
    faults,
    async handle(req, res) {
      if (req.headers.authorization !== EXPECTED_AUTH) {
        return send(res, 401, {
          errorMessages: ['Client must be authenticated to access this resource.'],
        });
      }
      const url = new URL(req.url ?? '/', 'http://fake');
      const fault = faults.get(`${req.method} ${url.pathname}`);
      if (fault) {
        faults.delete(`${req.method} ${url.pathname}`);
        res.writeHead(fault, { 'content-type': 'application/json', 'retry-after': '7' });
        res.end(JSON.stringify({ errorMessages: [`Fake fault ${fault}`] }));
        return;
      }
      if (url.pathname === '/rest/api/3/myself') {
        return send(res, 200, {
          accountId: 'acc-1',
          displayName: 'Alex Example',
          emailAddress: JIRA_EMAIL,
        });
      }
      if (url.pathname === '/rest/api/3/search/jql' && req.method === 'POST') {
        const body = await readJson(req);
        const found = search(String(body.jql));
        return send(res, 200, {
          issues: found.map((item) => ({
            id: issueId(item),
            key: item.key,
            fields: fields(item),
          })),
        });
      }
      if (url.pathname === '/rest/api/3/issue' && req.method === 'POST') {
        return createIssue(res, await readJson(req));
      }
      const project = PROJECT_STATUSES.exec(url.pathname);
      if (project) return projectStatuses(res, decodeURIComponent(project[1]!));
      const dev = DEV_STATUS.exec(url.pathname);
      if (dev) return devStatusRoute(res, url, dev[1]!);
      const match = ISSUE.exec(url.pathname);
      if (match) return issueRoute(req, res, match[1]!, match[2], match[3]);
      send(res, 404, { errorMessages: ['Not found'] });
    },
  };
}
