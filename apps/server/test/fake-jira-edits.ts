import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FakeJiraIssue } from './fake-jira.ts';

export interface FakeJiraComment {
  author: string;
  authorId?: string;
  body: unknown;
  created: string;
  updated?: string;
}

export interface JiraEditRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  item: FakeJiraIssue;
  sub: string | undefined;
  commentId: string | undefined;
  issues: FakeJiraIssue[];
  body: () => Promise<Record<string, unknown>>;
  send: (res: ServerResponse, status: number, body?: unknown) => void;
  people: Record<string, string>;
}

const commentIdOf = (index: number) => String(1000 + index);

export function commentView(
  comment: FakeJiraComment,
  index: number,
  people: Record<string, string>,
) {
  const authorId = comment.authorId ?? null;
  return {
    id: commentIdOf(index),
    author: {
      ...(authorId ? { accountId: authorId } : {}),
      displayName: authorId ? (people[authorId] ?? comment.author) : comment.author,
    },
    body: comment.body,
    created: comment.created,
    updated: comment.updated ?? comment.created,
  };
}

function touch(item: FakeJiraIssue) {
  item.updated = new Date(Date.parse(item.updated) + 60_000).toISOString().replace('Z', '+0000');
}

async function editFields(request: JiraEditRequest) {
  const { item, res, send } = request;
  const fields = (await request.body()).fields as Record<string, unknown> | undefined;
  if (!fields) return send(res, 400, { errorMessages: ['fields is required'] });
  if (typeof fields.summary === 'string') item.summary = fields.summary;
  if (fields.description !== undefined) item.description = fields.description;
  if (Array.isArray(fields.labels)) item.labels = fields.labels as string[];
  const priority = fields.priority as { name?: string } | undefined;
  if (priority?.name) item.priority = priority.name;
  touch(item);
  return send(res, 204);
}

function deleteIssue(request: JiraEditRequest) {
  const { item, res, send, url, issues } = request;
  if (item.subtasks.length > 0 && url.searchParams.get('deleteSubtasks') !== 'true') {
    return send(res, 400, {
      errorMessages: ['The issue has subtasks. Use deleteSubtasks=true to delete them too.'],
    });
  }
  for (const key of [item.key, ...item.subtasks]) {
    const index = issues.findIndex((entry) => entry.key === key);
    if (index >= 0) issues.splice(index, 1);
  }
  return send(res, 204);
}

async function commentRoute(request: JiraEditRequest) {
  const { item, res, send, req, commentId, people } = request;
  const index = item.comments.findIndex((_comment, at) => commentIdOf(at) === commentId);
  const comment = item.comments[index];
  if (!comment || comment.created === 'deleted') {
    return send(res, 404, { errorMessages: ['Comment not found.'] });
  }
  if (req.method === 'GET') return send(res, 200, commentView(comment, index, people));
  if (req.method === 'PUT') {
    comment.body = (await request.body()).body;
    comment.updated = new Date(Date.now() + 1_000).toISOString();
    return send(res, 200, commentView(comment, index, people));
  }
  if (req.method === 'DELETE') {
    comment.created = 'deleted';
    return send(res, 204);
  }
  return send(res, 405, { errorMessages: ['Method not allowed'] });
}

function listComments(request: JiraEditRequest) {
  const { item, res, send, people } = request;
  const live = item.comments
    .map((comment, index) => ({ comment, index }))
    .filter(({ comment }) => comment.created !== 'deleted')
    .map(({ comment, index }) => commentView(comment, index, people))
    .toReversed();
  return send(res, 200, { comments: live, total: live.length });
}

export async function jiraEditRoute(request: JiraEditRequest): Promise<boolean> {
  const { sub, commentId, req } = request;
  if (!sub && req.method === 'PUT') return (await editFields(request), true);
  if (!sub && req.method === 'DELETE') return (deleteIssue(request), true);
  if (sub === 'comment' && commentId) return (await commentRoute(request), true);
  if (sub === 'comment' && req.method === 'GET') return (listComments(request), true);
  return false;
}
