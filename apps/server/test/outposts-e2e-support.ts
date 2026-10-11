import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  API_TOKEN_HEADER,
  outpostDetailSchema,
  type OutpostDetail,
  type OutpostPost,
} from '@spark-outpost/contracts';
import { AppEventFeed, listenForAppEvents } from '../src/api/app-events.ts';
import { createApp } from '../src/api/app.ts';
import { outpostDelivery } from '../src/outposts/mount.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import type { Provider } from '../src/providers/provider.ts';
import { startWorker } from '../src/workflow/worker.ts';
import { API_TOKEN, ORIGIN, testAppOptions } from './app-support.ts';
import { testDatabaseUrl, type TestDb } from './support.ts';

export interface Gate {
  open(): void;
  opened: Promise<void>;
}

export function gate(): Gate {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function heldProvider(held: Promise<void>): Provider {
  const fake = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return {
    name: fake.name,
    async *run(turn) {
      const stopped = new Promise<void>((resolve) => {
        turn.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      await Promise.race([held, stopped]);
      yield* fake.run(turn);
    },
  };
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

export interface StackOptions {
  dispatch?: boolean;
  held?: Promise<void>;
}

export interface Stack {
  changed: string[];
  get(path: string): request.Test;
  send(method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object): request.Test;
  stop(): Promise<void>;
}

export async function startStack(t: TestDb, options: StackOptions = {}): Promise<Stack> {
  const server = createServer();
  const port = await listening(server);
  const outposts = outpostDelivery({ db: t.db, port, apiToken: API_TOKEN });
  const changed: string[] = [];
  const appEvents = new AppEventFeed(undefined, (event) => {
    if (event.kind === 'outpost_changed' && event.outpostId) changed.push(event.outpostId);
    outposts.changed(event);
  });
  const events = await listenForAppEvents(testDatabaseUrl(), appEvents);
  server.on('request', createApp(testAppOptions(t, { port, outposts, appEvents })));
  const provider = heldProvider(options.held ?? Promise.resolve());
  const worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 20,
    queueTarget: async () => ({ provider: provider.name }),
  });
  if (options.dispatch !== false) outposts.start();

  return {
    changed,
    get: (path) => request(server).get(path).set(API_TOKEN_HEADER, API_TOKEN),
    send: (method, path, body = {}) => {
      const call = request(server)[method](path);
      return call.set(API_TOKEN_HEADER, API_TOKEN).set('Origin', ORIGIN).send(body);
    },
    async stop() {
      await outposts.close();
      await worker.stop();
      await events.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export interface Room {
  outpostId: string;
  api: string;
  web: string;
}

export async function openRoom(stack: Stack): Promise<Room> {
  const room = { outpostId: randomUUID(), api: randomUUID(), web: randomUUID() };
  await stack.send('post', '/api/conversations', { id: room.api }).expect(201);
  await stack.send('post', '/api/conversations', { id: room.web }).expect(201);
  await stack
    .send('post', '/api/outposts', { id: room.outpostId, name: 'Orders launch', members: [] })
    .expect(201);
  await stack
    .send('put', `/api/outposts/${room.outpostId}/members/${room.api}`, { handle: 'api' })
    .expect(200);
  await stack
    .send('put', `/api/outposts/${room.outpostId}/members/${room.web}`, { handle: 'web' })
    .expect(200);
  return room;
}

export async function readRoom(stack: Stack, outpostId: string): Promise<OutpostDetail> {
  const response = await stack.get(`/api/outposts/${outpostId}`).expect(200);
  return outpostDetailSchema.parse(response.body);
}

export async function post(stack: Stack, outpostId: string, text: string): Promise<OutpostPost> {
  const id = randomUUID();
  const response = await stack.send('post', `/api/outposts/${outpostId}/posts`, { id, text });
  if (response.status !== 201) throw new Error(`Posting failed with ${response.status}.`);
  const created = outpostDetailSchema.parse(response.body).posts.find((found) => found.id === id);
  if (!created) throw new Error('The post is not in the thread.');
  return created;
}

export async function shown(stack: Stack, outpostId: string, postId: string): Promise<OutpostPost> {
  const found = (await readRoom(stack, outpostId)).posts.find((each) => each.id === postId);
  if (!found) throw new Error('The post is not in the thread.');
  return found;
}
