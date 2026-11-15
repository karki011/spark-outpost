import type { IncomingMessage, ServerResponse } from 'node:http';

type Send = (res: ServerResponse, status: number, body?: unknown) => void;

export interface FakeSprint {
  id: number;
  name: string;
  state: 'future' | 'active' | 'closed';
  startDate?: string;
  endDate?: string;
  goal?: string;
  originBoardId: number;
}

export interface FakeAgile {
  sprints: FakeSprint[];
  issueSprints: Record<string, number | null>;
  ranks: { key: string; other: string; after: boolean }[];
}

export const BOARD = { id: 7, name: 'WEB board', type: 'scrum', location: { projectKey: 'WEB' } };

export async function agileRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  agile: FakeAgile,
  send: Send,
  json: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const path = url.pathname.replace('/rest/agile/1.0', '');
  if (!url.pathname.startsWith('/rest/agile/1.0')) return false;
  if (path === '/board') return (send(res, 200, { values: [BOARD], isLast: true }), true);
  if (path === `/board/${BOARD.id}`) return (send(res, 200, BOARD), true);
  if (path === `/board/${BOARD.id}/sprint`) {
    const states = (url.searchParams.get('state') ?? 'active,future').split(',');
    return (
      send(res, 200, {
        values: agile.sprints.filter((sprint) => states.includes(sprint.state)),
        isLast: true,
      }),
      true
    );
  }
  if (path === '/sprint' && req.method === 'POST') {
    const body = (await json(req)) as Partial<FakeSprint>;
    const sprint: FakeSprint = {
      id: 100 + agile.sprints.length,
      name: String(body.name),
      state: 'future',
      originBoardId: Number(body.originBoardId),
      ...(body.goal ? { goal: body.goal } : {}),
    };
    agile.sprints.push(sprint);
    return (send(res, 201, sprint), true);
  }
  const sprint = /^\/sprint\/(\d+)(\/issue)?$/.exec(path);
  if (sprint) {
    const found = agile.sprints.find((entry) => entry.id === Number(sprint[1]));
    if (!found) return (send(res, 404, { errorMessages: ['Sprint does not exist.'] }), true);
    if (req.method === 'GET') return (send(res, 200, found), true);
    const body = (await json(req)) as {
      issues?: string[];
      state?: FakeSprint['state'];
      startDate?: string;
      endDate?: string;
    };
    if (sprint[2]) {
      for (const key of body.issues ?? []) agile.issueSprints[key] = found.id;
      return (send(res, 204), true);
    }
    if (body.state === 'active' && (!body.startDate || !body.endDate)) {
      return (
        send(res, 400, { errorMessages: ['Sprint start and end dates are required.'] }),
        true
      );
    }
    Object.assign(found, body);
    return (send(res, 200, found), true);
  }
  if (path === '/backlog/issue') {
    const body = (await json(req)) as { issues: string[] };
    for (const key of body.issues) agile.issueSprints[key] = null;
    return (send(res, 204), true);
  }
  if (path === '/issue/rank') {
    const body = (await json(req)) as {
      issues: string[];
      rankBeforeIssue?: string;
      rankAfterIssue?: string;
    };
    agile.ranks.push({
      key: body.issues[0]!,
      other: body.rankAfterIssue ?? body.rankBeforeIssue ?? '',
      after: !!body.rankAfterIssue,
    });
    return (send(res, 204), true);
  }
  return (send(res, 404, { errorMessages: ['Not found'] }), true);
}
