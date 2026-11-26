import {
  ARTIFACT_SHARE_DELETE_TOKEN_PATTERN,
  ARTIFACT_SHARE_FINAL_HEADER,
  ARTIFACT_SHARE_ID_PATTERN,
  ARTIFACT_SHARE_SERVICE_PATH,
} from '@spark-outpost/contracts';
import { createHash } from 'node:crypto';
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
  retires: boolean;
  uploadKey: string | null;
  info: unknown;
  serviceCalls: IncomingMessage['headers'][];
  uploadMs: number;
  posts: ReceivedShare[];
  answered: { method: string; id: string; status: number }[];
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

function idGivenBy(deleteToken: string): string {
  const digest = createHash('sha256').update(`spark-share-id:${deleteToken}`).digest();
  return digest.subarray(0, 16).toString('base64url');
}

const SHARE_PATH = /^\/v1\/shares\/([A-Za-z0-9_-]+)$/;

export const BUSY_TITLE = 'Busy';

export function fakeShareService(): FakeShareService {
  const service: FakeShareService = {
    shares: new Map(),
    retired: new Set(),
    retires: true,
    uploadKey: null,
    info: null,
    serviceCalls: [],
    uploadMs: 0,
    posts: [],
    answered: [],
    deletes: [],
    answer: null,
    async handle(req, res) {
      const path = (req.url ?? '').split('?')[0]!;
      const origin = `http://${req.headers.host}`;
      const keyed =
        service.uploadKey === null || req.headers.authorization === `Bearer ${service.uploadKey}`;
      if (req.method === 'GET' && path === ARTIFACT_SHARE_SERVICE_PATH) {
        service.serviceCalls.push(req.headers);
        if (!keyed) {
          send(res, 401, { error: 'unauthorized' });
          return true;
        }
        const info = {
          service: 'spark-share',
          maxDays: 7,
          uploadKey: service.uploadKey === null ? 'none' : 'required',
        };
        send(res, 200, service.info ?? info);
        return true;
      }
      if (req.method === 'POST' && path === '/v1/shares' && !keyed) {
        await readBody(req);
        service.answered.push({ method: 'POST', id: '', status: 401 });
        send(res, 401, { error: 'unauthorized' });
        return true;
      }
      if (req.method === 'POST' && path === '/v1/shares') {
        const body = JSON.parse(await readBody(req)) as Omit<ReceivedShare, 'keys' | 'headers'>;
        const received = { ...body, keys: Object.keys(body).sort(), headers: req.headers };
        service.posts.push(received);
        const share = { id: body.id, deleteToken: body.deleteToken, received };
        const reply = (status: number, answer: unknown, headers?: Record<string, string>) => {
          service.answered.push({ method: 'POST', id: String(body.id), status });
          send(res, status, answer, headers);
          return true;
        };
        if (service.uploadMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, service.uploadMs));
        }
        const custom = service.answer?.(share, origin);
        if (custom) return reply(custom.status, custom.body, custom.headers);
        if (
          !ARTIFACT_SHARE_ID_PATTERN.test(String(body.id)) ||
          !ARTIFACT_SHARE_DELETE_TOKEN_PATTERN.test(String(body.deleteToken)) ||
          idGivenBy(body.deleteToken) !== body.id
        ) {
          return reply(400, { error: 'bad_request' });
        }
        const known = service.shares.get(share.id);
        if (service.retired.has(share.id) || (known && known.deleteToken !== share.deleteToken)) {
          return reply(409, { error: 'conflict' });
        }
        if (!known) service.shares.set(share.id, share);
        const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString();
        return reply(201, { id: share.id, url: `${origin}/a/${share.id}`, expiresAt });
      }
      const match = SHARE_PATH.exec(path);
      if (req.method === 'DELETE' && match) {
        const id = match[1]!;
        const authorization = req.headers.authorization;
        service.deletes.push({ id, authorization });
        const reply = (status: number, headers?: Record<string, string>) => {
          service.answered.push({ method: 'DELETE', id, status });
          send(res, status, status === 204 ? null : { error: 'not_found' }, headers);
          return true;
        };
        const share = service.shares.get(id);
        const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
        if (token === undefined) return reply(404);
        if (!share && !service.retires) return reply(404);
        if (!share) {
          if (idGivenBy(token) === id) service.retired.add(id);
          return reply(404, { [ARTIFACT_SHARE_FINAL_HEADER]: '1' });
        }
        if (token !== share.deleteToken) return reply(404);
        service.shares.delete(id);
        if (service.retires) service.retired.add(id);
        return reply(204);
      }
      return false;
    },
  };
  return service;
}
