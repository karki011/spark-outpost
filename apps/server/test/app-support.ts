import request from 'supertest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { AppEventFeed } from '../src/api/app-events.ts';
import { createApp, type AppOptions } from '../src/api/app.ts';
import { RunEventHub } from '../src/api/run-event-hub.ts';
import type { CommandResult, RunCommand } from '../src/setup/command.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import type { TestDb } from './support.ts';

export const PORT = 4318;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = 'http://localhost:5173';
export const API_TOKEN = 'test-launch-token-0123456789abcdefghijkl';
export const LOCAL_HEADERS = { Host: HOST, [API_TOKEN_HEADER]: API_TOKEN };

export interface TestAppOptions {
  fetch?: typeof fetch;
  runCommand?: RunCommand;
  secrets?: SecretStore;
  fixedRunProvider?: string | null;
  probeCapabilities?: AppOptions['probeCapabilities'];
  appEvents?: AppEventFeed;
  githubApiUrl?: string;
  githubApp?: AppOptions['githubApp'];
  githubSignInSleep?: AppOptions['githubSignInSleep'];
  linearApiUrl?: string;
  locateGh?: () => Promise<string | null>;
  serverSpendCapUsd?: number;
  parallelBuilders?: boolean;
  openFolder?: AppOptions['openFolder'];
  terminals?: TerminalSessions;
  diagnostics?: AppOptions['diagnostics'];
  deleteSettleMs?: number;
}

const unavailableProbe: AppOptions['probeCapabilities'] = () =>
  Promise.reject(new Error('Capability probes are disabled in tests'));

const notFound: CommandResult = { code: 1, stdout: '', stderr: '' };

export const noClis: RunCommand = async () => notFound;

export const installedClis: RunCommand = async (file, args) => {
  if (file === '/usr/bin/which')
    return { code: 0, stdout: `/usr/local/bin/${args[0]}\n`, stderr: '' };
  if (args[0] === '--version') return { code: 0, stdout: '1.0.0\n', stderr: '' };
  return notFound;
};

export function createTestApp(t: TestDb, options: TestAppOptions = {}) {
  return createApp({
    db: t.db,
    hub: new RunEventHub(),
    workspaceId: t.workspaceId,
    ...(options.fixedRunProvider === null
      ? {}
      : { fixedRunProvider: options.fixedRunProvider ?? 'fake' }),
    port: PORT,
    allowedOrigins: [ORIGIN],
    apiToken: API_TOKEN,
    secrets: options.secrets ?? memorySecretStore(),
    endpoints: {
      anthropicBaseUrl: 'https://anthropic.test',
      openaiBaseUrl: 'https://openai.test',
      typesafeBaseUrl: 'https://typesafe.test',
      zaiBaseUrl: 'https://zai.test',
      fetch: options.fetch ?? (() => Promise.reject(new Error('Network disabled in tests'))),
    },
    runCommand: options.runCommand ?? noClis,
    terminals: options.terminals ?? new TerminalSessions(loginShellSpawner('/bin/sh')),
    appEvents: options.appEvents ?? new AppEventFeed(),
    loginShell: '/bin/zsh',
    probeCapabilities: options.probeCapabilities ?? unavailableProbe,
    githubApiUrl: options.githubApiUrl,
    githubApp: options.githubApp,
    ...(options.githubSignInSleep ? { githubSignInSleep: options.githubSignInSleep } : {}),
    linearApiUrl: options.linearApiUrl,
    locateGh: options.locateGh ?? (async () => null),
    serverSpendCapUsd: options.serverSpendCapUsd,
    parallelBuilders: options.parallelBuilders,
    ...(options.deleteSettleMs === undefined ? {} : { deleteSettleMs: options.deleteSettleMs }),
    ...(options.openFolder ? { openFolder: options.openFolder } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  });
}

export function localClient(app: ReturnType<typeof createTestApp>) {
  return {
    get: (path: string) => request(app).get(path).set(LOCAL_HEADERS),
    send: (method: 'post' | 'put' | 'patch' | 'delete', path: string, body: object = {}) =>
      request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body),
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
