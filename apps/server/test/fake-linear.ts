import type { IncomingMessage, ServerResponse } from 'node:http';

export const LINEAR_KEY = 'lin_api_fake_0123456789abcdefghij';

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
  assignedToMe: boolean;
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
  assignedToMe: true,
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
    }),
    issue({ identifier: 'ENG-14', title: 'Old cleanup', stateId: 'eng-done' }),
    issue({
      identifier: 'ENG-15',
      title: 'Someone else’s ticket',
      assignedToMe: false,
    }),
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

const OPERATION = /^\s*(?:query|mutation)\s+(\w+)/;

interface StateFilter {
  type?: { in?: string[]; nin?: string[] };
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
      priorityLabel: 'High',
      state: { id: current.id, name: current.name, type: current.type },
      team: { key: item.team },
      cycle: { name: null, number: 7 },
    };
  }

  function detail(item: FakeLinearIssue) {
    return {
      ...node(item),
      description: item.description,
      assignee: { name: 'Alex Example' },
      labels: { nodes: [{ name: 'bug' }] },
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

  function assigned(variables: Record<string, unknown>) {
    const filter = (variables.filter ?? {}) as {
      state?: StateFilter;
      team?: { key?: { eqIgnoreCase?: string } };
    };
    const team = filter.team?.key?.eqIgnoreCase?.toUpperCase();
    return issues.filter((item) => {
      const type = stateOf(item).type;
      if (!item.assignedToMe) return false;
      if (filter.state?.type?.in && !filter.state.type.in.includes(type)) return false;
      if (filter.state?.type?.nin?.includes(type)) return false;
      return !team || item.team === team;
    });
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
