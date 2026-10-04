import type { IncomingMessage, ServerResponse } from 'node:http';

export const LINEAR_KEY = 'lin_api_fake_0123456789abcdefghij';
export const LINEAR_ME = 'user-1';

export const linearPeople: Record<string, string> = {
  'user-1': 'Alex Example',
  'user-2': 'Jordan Lee',
};

const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

export interface FakeLinearState {
  id: string;
  name: string;
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export interface FakeLinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  team: string;
  stateId: string;
  updatedAt: string;
  assigneeId: string | null;
  priority: number;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  creatorId: string | null;
  labels: string[];
  comments: { body: string; createdAt: string; user: string }[];
  attachments: { title: string; url: string }[];
  children: string[];
}

export interface FakeLinear {
  teams: Record<string, FakeLinearState[]>;
  issues: FakeLinearIssue[];
  calls: string[];
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

const state = (id: string, name: string, type: FakeLinearState['type']): FakeLinearState => ({
  id,
  name,
  type,
});

function seedTeams(): Record<string, FakeLinearState[]> {
  return {
    ENG: [
      state('eng-backlog', 'Backlog', 'backlog'),
      state('eng-todo', 'Todo', 'unstarted'),
      state('eng-progress', 'In Progress', 'started'),
      state('eng-review', 'In Review', 'started'),
      state('eng-done', 'Done', 'completed'),
      state('eng-canceled', 'Canceled', 'canceled'),
    ],
    OPS: [
      state('ops-todo', 'Todo', 'unstarted'),
      state('ops-doing', 'Doing', 'started'),
      state('ops-done', 'Done', 'completed'),
    ],
  };
}

const issue = (
  fields: Partial<FakeLinearIssue> & Pick<FakeLinearIssue, 'identifier' | 'title'>,
) => ({
  id: `id-${fields.identifier}`,
  description: '',
  team: fields.identifier.split('-')[0]!,
  stateId: 'eng-todo',
  updatedAt: '2026-09-20T10:00:00.000Z',
  assigneeId: LINEAR_ME,
  priority: 2,
  dueDate: null,
  completedAt: null,
  createdAt: '2026-09-18T09:00:00.000Z',
  creatorId: 'user-2',
  labels: ['bug'],
  comments: [],
  attachments: [],
  children: [],
  ...fields,
});

function seedIssues(): FakeLinearIssue[] {
  return [
    issue({
      identifier: 'ENG-12',
      title: 'Date divider shows Today twice',
      description:
        'The chat list repeats the Today divider after a refresh.\n\n## Acceptance criteria\n\n- One Today divider\n- Works after midnight',
      updatedAt: '2026-09-27T09:00:00.000Z',
      comments: [
        { body: 'Seen on Safari too.', createdAt: '2026-09-26T08:00:00.000Z', user: 'Sam' },
      ],
      children: ['ENG-13'],
    }),
    issue({
      identifier: 'ENG-13',
      title: 'Add a test for the divider',
      stateId: 'eng-progress',
      updatedAt: '2026-09-25T09:00:00.000Z',
      creatorId: null,
    }),
    issue({
      identifier: 'ENG-14',
      title: 'Old cleanup',
      stateId: 'eng-done',
      completedAt: '2026-09-27T08:00:00.000Z',
    }),
    issue({
      identifier: 'ENG-15',
      title: 'Someone else’s ticket',
      assigneeId: 'user-2',
    }),
    issue({ identifier: 'ENG-16', title: 'Unowned upload bug', assigneeId: null }),
    issue({
      identifier: 'OPS-4',
      title: 'Rotate staging certificates',
      stateId: 'ops-todo',
      updatedAt: '2026-09-26T09:00:00.000Z',
    }),
  ];
}

async function readJson(
  req: IncomingMessage,
): Promise<{ query?: string; variables?: Record<string, unknown> }> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  try {
    return JSON.parse(text || '{}') as { query?: string; variables?: Record<string, unknown> };
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const TEAM_LABELS = [
  { id: 'label-bug', name: 'bug' },
  { id: 'label-feature', name: 'feature' },
];

const OPERATION = /^\s*(?:query|mutation)\s+(\w+)/;

interface StateFilter {
  type?: { in?: string[]; nin?: string[] };
}

interface IssueFilter {
  state?: StateFilter;
  team?: { key?: { eqIgnoreCase?: string } };
  completedAt?: { gte?: string };
  assignee?: { isMe?: { eq?: boolean }; null?: boolean };
  number?: { eq?: number };
  or?: { title?: { containsIgnoreCase?: string } }[];
}

export function fakeLinear(): FakeLinear {
  const teams = seedTeams();
  const issues = seedIssues();
  const calls: string[] = [];

  const stateOf = (item: FakeLinearIssue) =>
    teams[item.team]!.find((entry) => entry.id === item.stateId)!;
  const find = (id: unknown) =>
    issues.find((item) => item.identifier === id || item.id === id) ?? null;

  function node(item: FakeLinearIssue) {
    const current = stateOf(item);
    return {
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      url: `https://linear.app/acme/issue/${item.identifier}`,
      updatedAt: item.updatedAt,
      priorityLabel: PRIORITY_LABELS[item.priority] ?? null,
      priority: item.priority,
      dueDate: item.dueDate,
      completedAt: item.completedAt,
      createdAt: item.createdAt,
      creator: item.creatorId ? { name: linearPeople[item.creatorId] ?? item.creatorId } : null,
      assignee: item.assigneeId
        ? { id: item.assigneeId, name: linearPeople[item.assigneeId] ?? item.assigneeId }
        : null,
      labels: { nodes: item.labels.map((name) => ({ name })) },
      state: { id: current.id, name: current.name, type: current.type },
      team: { key: item.team },
      cycle: { name: null, number: 7 },
    };
  }

  function detail(item: FakeLinearIssue) {
    return {
      ...node(item),
      description: item.description,
      comments: { nodes: item.comments.map((c) => ({ ...c, user: { name: c.user } })) },
      attachments: { nodes: item.attachments },
      children: {
        nodes: item.children.map((key) => {
          const child = find(key)!;
          return { identifier: child.identifier, title: child.title, state: stateOf(child) };
        }),
      },
    };
  }

  function assigneeMatches(item: FakeLinearIssue, filter: IssueFilter['assignee']) {
    if (!filter) return true;
    if (filter.null !== undefined && (item.assigneeId === null) !== filter.null) return false;
    const isMe = filter.isMe?.eq;
    return isMe === undefined || (item.assigneeId === LINEAR_ME) === isMe;
  }

  function matches(item: FakeLinearIssue, filter: IssueFilter) {
    const type = stateOf(item).type;
    const team = filter.team?.key?.eqIgnoreCase?.toUpperCase();
    const text = filter.or?.[0]?.title?.containsIgnoreCase?.toLowerCase();
    if (filter.state?.type?.in && !filter.state.type.in.includes(type)) return false;
    if (filter.state?.type?.nin?.includes(type)) return false;
    if (team && item.team !== team) return false;
    if (filter.completedAt?.gte && (item.completedAt ?? '') < filter.completedAt.gte) return false;
    if (filter.number?.eq !== undefined && !item.identifier.endsWith(`-${filter.number.eq}`)) {
      return false;
    }
    if (text && !`${item.title} ${item.description}`.toLowerCase().includes(text)) return false;
    return assigneeMatches(item, filter.assignee);
  }

  function assigned(variables: Record<string, unknown>) {
    const filter = (variables.filter ?? {}) as IssueFilter;
    return issues.filter((item) => item.assigneeId === LINEAR_ME && matches(item, filter));
  }

  function searched(variables: Record<string, unknown>) {
    return issues.filter((item) => matches(item, (variables.filter ?? {}) as IssueFilter));
  }

  function teamAnswer(key: string) {
    const found = teams[key.toUpperCase()];
    return {
      teams: {
        nodes: found
          ? [
              {
                id: `team-${key.toUpperCase()}`,
                key: key.toUpperCase(),
                labels: { nodes: TEAM_LABELS },
              },
            ]
          : [],
      },
    };
  }

  function created(raw: unknown): FakeLinearIssue {
    const input = raw as {
      teamId: string;
      title: string;
      description: string;
      priority?: number;
      labelIds?: string[];
      assigneeId?: string;
    };
    const team = input.teamId.replace('team-', '');
    const number = issues.filter((item) => item.team === team).length + 100;
    const made: FakeLinearIssue = {
      id: `id-${team}-${number}`,
      identifier: `${team}-${number}`,
      title: input.title,
      description: input.description,
      team,
      stateId: teams[team]![0]!.id,
      updatedAt: new Date().toISOString(),
      assigneeId: input.assigneeId ?? null,
      priority: input.priority ?? 0,
      dueDate: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      creatorId: LINEAR_ME,
      labels: (input.labelIds ?? []).map(
        (id) => TEAM_LABELS.find((label) => label.id === id)?.name ?? id,
      ),
      comments: [],
      attachments: [],
      children: [],
    };
    issues.push(made);
    return made;
  }

  function answer(operation: string, variables: Record<string, unknown>): unknown {
    const target = find(variables.id ?? variables.issueId);
    switch (operation) {
      case 'Viewer':
        return { viewer: { id: 'user-1', name: 'Alex Example', email: 'alex@example.test' } };
      case 'Assigned':
        return { viewer: { assignedIssues: { nodes: assigned(variables).map(node) } } };
      case 'Issue':
        return { issue: target ? detail(target) : null };
      case 'Summary':
        return { issue: target ? node(target) : null };
      case 'Search':
        return { issues: { nodes: searched(variables).map(node) } };
      case 'Assign':
        target!.assigneeId = variables.assigneeId === null ? null : String(variables.assigneeId);
        return { issueUpdate: { success: true } };
      case 'States':
        return target
          ? {
              issue: {
                id: target.id,
                state: stateOf(target),
                team: { key: target.team, states: { nodes: teams[target.team] } },
              },
            }
          : null;
      case 'Move':
        target!.stateId = String(variables.stateId);
        return { issueUpdate: { success: true } };
      case 'Comment':
        target!.comments.push({
          body: String(variables.body),
          createdAt: new Date().toISOString(),
          user: 'Alex Example',
        });
        return { commentCreate: { success: true } };
      case 'Team':
        return teamAnswer(String(variables.key));
      case 'Create':
        return { issueCreate: { success: true, issue: node(created(variables.input)) } };
      case 'Link':
        if (!target!.attachments.some((link) => link.url === variables.url)) {
          target!.attachments.push({ title: String(variables.title), url: String(variables.url) });
        }
        return { attachmentLinkURL: { success: true } };
      default:
        return null;
    }
  }

  return {
    teams,
    issues,
    calls,
    async handle(req, res) {
      const body = await readJson(req);
      if (req.headers.authorization !== LINEAR_KEY) {
        return send(res, 400, {
          errors: [
            {
              message: 'Authentication required, not authenticated',
              extensions: { code: 'AUTHENTICATION_ERROR' },
            },
          ],
        });
      }
      const query = body.query ?? '';
      const operation =
        OPERATION.exec(query)?.[1] ?? (query.includes('viewer { id name') ? 'Viewer' : '');
      calls.push(operation);
      const data = answer(operation, body.variables ?? {});
      if (!data) return send(res, 200, { errors: [{ message: 'Entity not found' }] });
      send(res, 200, { data });
    },
  };
}
