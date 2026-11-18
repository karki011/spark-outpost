import {
  ARTIFACT_SHARE_DELETE_TOKEN_PATTERN,
  ARTIFACT_SHARE_ID_PATTERN,
} from '@spark-outpost/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ReceivedShare {
  id: string;
  deleteToken: string;
  title: string;
  html: string;
  expiresInDays: number;
  passcode?: string;
  keys: string[];
  headers: IncomingMessage['headers'];
}

export interface StoredShare {
  id: string;
  deleteToken: string;
  received: ReceivedShare;
}

export interface FakeShareService {
  shares: Map<string, StoredShare>;
  retired: Set<string>;
  posts: ReceivedShare[];
  deletes: { id: string; authorization: string | undefined }[];
  answer:
    | ((
        share: StoredShare,
        origin: string,
      ) => { status: number; body: unknown; headers?: Record<string, string> } | null)
    | null;
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (status === 204) {
    res.writeHead(204).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return text;
}

const SHARE_PATH = /^\/v1\/shares\/([A-Za-z0-9_-]+)$/;

export const BUSY_TITLE = 'Busy';

export function fakeShareService(): FakeShareService {
  const service: FakeShareService = {
    shares: new Map(),
    retired: new Set(),
    posts: [],
    deletes: [],
    answer: null,
    async handle(req, res) {
      const path = (req.url ?? '').split('?')[0]!;
      const origin = `http://${req.headers.host}`;
      if (req.method === 'POST' && path === '/v1/shares') {
        const body = JSON.parse(await readBody(req)) as Omit<ReceivedShare, 'keys' | 'headers'>;
        const received = { ...body, keys: Object.keys(body).sort(), headers: req.headers };
        service.posts.push(received);
        const share = { id: body.id, deleteToken: body.deleteToken, received };
        const custom = service.answer?.(share, origin);
        if (custom) {
          send(res, custom.status, custom.body, custom.headers);
          return true;
        }
        if (
          !ARTIFACT_SHARE_ID_PATTERN.test(String(body.id)) ||
          !ARTIFACT_SHARE_DELETE_TOKEN_PATTERN.test(String(body.deleteToken))
        ) {
          send(res, 400, { error: 'bad_request' });
          return true;
        }
        const known = service.shares.get(share.id);
        if (service.retired.has(share.id) || (known && known.deleteToken !== share.deleteToken)) {
          send(res, 409, { error: 'conflict' });
          return true;
        }
        if (!known) service.shares.set(share.id, share);
        const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
        send(res, 201, { id: share.id, url: `${origin}/a/${share.id}`, expiresAt });
        return true;
      }
      const match = SHARE_PATH.exec(path);
      if (req.method === 'DELETE' && match) {
        const id = match[1]!;
        const authorization = req.headers.authorization;
        service.deletes.push({ id, authorization });
        const share = service.shares.get(id);
        if (!share) service.retired.add(id);
        if (!share || authorization !== `Bearer ${share.deleteToken}`) {
          send(res, 404, { error: 'not_found' });
          return true;
        }
        service.shares.delete(id);
        service.retired.add(id);
        send(res, 204, null);
        return true;
      }
      return false;
    },
  };
  return service;
}
