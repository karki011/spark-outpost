import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  type Client,
} from '@a2a-js/sdk/client';
import { API_TOKEN_HEADER, parseAppEvent } from '@spark-outpost/contracts';
import express, { type NextFunction, type Request, type Response } from 'express';
import { a2aBaseUrl, A2A_MOUNT_PATH, chatEndpoint } from '../src/a2a/agent-card.ts';
import { a2aRoutes } from '../src/a2a/router.ts';
import { TaskWakes } from '../src/a2a/task-wakes.ts';
import { jsonBody } from '../src/api/json-body.ts';
import { localRequestGuard, requireLaunchToken } from '../src/api/security.ts';
import { listen } from '../src/persistence/notifications.ts';
import { standInGetPost, standInReadAnswer } from './a2a-stand-ins.ts';
import { testDatabaseUrl, type TestDb } from './support.ts';

export const LAUNCH_TOKEN = 'test-launch-token-0123456789abcdefghijkl';

export interface A2aHarness {
  baseUrl: string;
  wakes: TaskWakes;
  endpoint(chatId: string): string;
  client(chatId: string, token?: string | null): Promise<Client>;
  close(): Promise<void>;
}

export function tokenFetch(token: string | null): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (token !== null) headers.set(API_TOKEN_HEADER, token);
    return fetch(input, { ...init, headers });
  };
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startA2a(t: TestDb): Promise<A2aHarness> {
  const app = express();
  const server = createServer(app);
  const port = await listening(server);
  const wakes = new TaskWakes();
  const changes = await listen(testDatabaseUrl(), 'changes', (payload) => {
    const event = parseAppEvent(payload);
    if (event) wakes.changed(event);
  });
  app.use(localRequestGuard(port, []), requireLaunchToken(LAUNCH_TOKEN));
  app.use(jsonBody());
  app.use(
    A2A_MOUNT_PATH,
    a2aRoutes({
      db: t.db,
      workspaceId: t.workspaceId,
      fixedRunProvider: 'fake',
      port,
      getPost: standInGetPost,
      readAnswer: standInReadAnswer,
      wakes,
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : 'failed' });
  });
  const baseUrl = a2aBaseUrl(port);

  return {
    baseUrl,
    wakes,
    endpoint: (chatId) => chatEndpoint(baseUrl, chatId),
    client(chatId, token = LAUNCH_TOKEN) {
      const fetchImpl = tokenFetch(token);
      const factory = new ClientFactory(
        ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
          transports: [new JsonRpcTransportFactory({ fetchImpl })],
          cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
        }),
      );
      return factory.createFromUrl(`${chatEndpoint(baseUrl, chatId)}/`);
    },
    async close() {
      await changes.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
