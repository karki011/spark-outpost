import type { IncomingMessage, ServerResponse } from 'node:http';

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
  labels: string[];
  comments: { author: string; body: unknown; created: string }[];
  remoteLinks: { globalId: string; url: string; title: string }[];
  subtasks: string[];
}

export interface FakeJira {
  workflows: Record<string, Record<string, Category>>;
  issues: FakeJiraIssue[];
  jql: string[];
  denyAssign: Set<string>;
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
    { ...base, key: 'WEB-419', summary: 'CSV header row', status: 'In Progress' },
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

const EXPECTED_AUTH = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;
const ISSUE = /^\/rest\/api\/3\/issue\/([^/]+)(?:\/(remotelink|transitions|comment|assignee))?$/;

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
  const jql: string[] = [];
  const denyAssign = new Set<string>();

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
      labels: item.labels,
      comment: {
        comments: item.comments.map((c) => ({
          author: { displayName: c.author },
          body: c.body,
          created: c.created,
        })),
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
  ) {
    const item = issues.find((entry) => entry.key === decodeURIComponent(key));
    if (!item)
      return send(res, 404, {
        errorMessages: ['Issue does not exist or you do not have permission to see it.'],
      });
    if (!sub && req.method === 'GET')
      return send(res, 200, { key: item.key, fields: fields(item) });
    if (sub === 'remotelink' && req.method === 'GET') {
      return send(
        res,
        200,
        item.remoteLinks.map((link) => ({ object: { url: link.url, title: link.title } })),
      );
    }
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
        body: body.body,
        created: new Date().toISOString(),
      });
      return send(res, 201, { id: String(item.comments.length) });
    }
    send(res, 405, { errorMessages: ['Method not allowed'] });
  }

  return {
    workflows,
    issues,
    jql,
    denyAssign,
    async handle(req, res) {
      if (req.headers.authorization !== EXPECTED_AUTH) {
        return send(res, 401, {
          errorMessages: ['Client must be authenticated to access this resource.'],
        });
      }
      const url = new URL(req.url ?? '/', 'http://fake');
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
          issues: found.map((item) => ({ key: item.key, fields: fields(item) })),
        });
      }
      const match = ISSUE.exec(url.pathname);
      if (match) return issueRoute(req, res, match[1]!, match[2]);
      send(res, 404, { errorMessages: ['Not found'] });
    },
  };
}
