import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { allowSlackChannels } from '../src/slack/channels.ts';
import { saveSlack, type SlackDeps } from '../src/slack/connection.ts';
import {
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  SLACK_USER_TOKEN,
  fakeSlack,
  type FakeSlack,
} from './fake-slack.ts';
import type { TestDb } from './support.ts';

export interface FakeSlackSocket {
  url: string;
  acks: string[];
  connections(): number;
  send(envelope: Record<string, unknown>): void;
  drop(): void;
  close(): Promise<void>;
}

export async function startFakeSlackSocket(): Promise<FakeSlackSocket> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const clients = new Set<WebSocket>();
  const acks: string[] = [];
  server.on('connection', (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString()) as { envelope_id?: string };
      if (parsed.envelope_id) acks.push(parsed.envelope_id);
    });
    client.send(JSON.stringify({ type: 'hello' }));
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    acks,
    connections: () => clients.size,
    send: (envelope) => clients.forEach((client) => client.send(JSON.stringify(envelope))),
    drop: () => clients.forEach((client) => client.terminate()),
    close: () =>
      new Promise((resolve) => {
        clients.forEach((client) => client.terminate());
        server.close(() => resolve());
      }),
  };
}

export interface SlackStub {
  slack: FakeSlack;
  apiUrl: string;
  socket: FakeSlackSocket;
  close(): Promise<void>;
}

export async function startSlackStub(): Promise<SlackStub> {
  const slack = fakeSlack();
  const server: Server = createServer((req, res) => {
    void slack.handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = await startFakeSlackSocket();
  slack.socketUrl = socket.url;
  return {
    slack,
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    socket,
    close: async () => {
      await socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function slackDeps(t: TestDb, stub: SlackStub, secrets: SecretStore = memorySecretStore()) {
  return {
    db: t.db,
    workspaceId: t.workspaceId,
    secrets,
    fetch,
    slackApiUrl: stub.apiUrl,
    sleep: () => Promise.resolve(),
  } satisfies SlackDeps;
}

export const ALL_SLACK_TOKENS = {
  botToken: SLACK_BOT_TOKEN,
  userToken: SLACK_USER_TOKEN,
  appToken: SLACK_APP_TOKEN,
};

export async function connectSlack(
  deps: SlackDeps,
  options: { tokens?: typeof ALL_SLACK_TOKENS | { botToken: string }; channels?: string[] } = {},
): Promise<void> {
  await saveSlack(deps, options.tokens ?? ALL_SLACK_TOKENS);
  await allowSlackChannels(deps, {
    channels: (options.channels ?? ['C0ENG']).map((id) => ({ id, projectId: null })),
  });
}

export async function databaseText(t: TestDb): Promise<string> {
  const { rows } = await t.db.query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables
     WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'`,
  );
  const dumps = await Promise.all(
    rows.map(async ({ name }) => {
      const dump = await t.db.query<{ line: string }>(
        `SELECT row_to_json(r)::text AS line FROM "${name}" r`,
      );
      return dump.rows.map((row) => row.line).join('\n');
    }),
  );
  return dumps.join('\n');
}
