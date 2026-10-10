import request from 'supertest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { AppEventFeed } from '../src/api/app-events.ts';
import { createApp, type AppOptions } from '../src/api/app.ts';
import { RunEventHub } from '../src/api/run-event-hub.ts';
import type { CommandResult, RunCommand } from '../src/setup/command.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { outpostDelivery, type OutpostDelivery } from '../src/outposts/mount.ts';
import { PreviewServers } from '../src/preview/servers.ts';
import { AgentTerminals } from '../src/terminal/agent-terminals.ts';
import { fakeAgentTerminalRuntime } from './agent-terminal-support.ts';
import { fakePreviewRuntime } from './preview-support.ts';
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
  agentRuntime?: AppOptions['agentRuntime'];
  probeCapabilities?: AppOptions['probeCapabilities'];
  appEvents?: AppEventFeed;
  outposts?: OutpostDelivery;
  port?: number;
  githubApiUrl?: string;
  githubApp?: AppOptions['githubApp'];
  githubSignInSleep?: AppOptions['githubSignInSleep'];
  linearApiUrl?: string;
  slackApiUrl?: string;
  slackSignIn?: AppOptions['slackSignIn'];
  slackNotifier?: AppOptions['slackNotifier'];
  locateGh?: () => Promise<string | null>;
  openFolder?: AppOptions['openFolder'];
  terminals?: TerminalSessions;
  previews?: PreviewServers;
  agentTerminals?: AgentTerminals;
  diagnostics?: AppOptions['diagnostics'];
  deleteSettleMs?: number;
  cloneTest?: AppOptions['cloneTest'];
  webRoot?: string;
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

export function testAppOptions(t: TestDb, options: TestAppOptions = {}): AppOptions {
  const port = options.port ?? PORT;
  return {
    db: t.db,
    hub: new RunEventHub(),
    workspaceId: t.workspaceId,
    ...(options.fixedRunProvider === null
      ? {}
      : { fixedRunProvider: options.fixedRunProvider ?? 'fake' }),
    port,
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
    previews:
      options.previews ?? new PreviewServers(t.db, t.workspaceId, fakePreviewRuntime().runtime),
    agentTerminals:
      options.agentTerminals ??
      new AgentTerminals(t.db, t.workspaceId, fakeAgentTerminalRuntime().runtime),
    appEvents: options.appEvents ?? new AppEventFeed(),
    outposts: options.outposts ?? outpostDelivery({ db: t.db, port, apiToken: API_TOKEN }),
    loginShell: '/bin/zsh',
    probeCapabilities: options.probeCapabilities ?? unavailableProbe,
    githubApiUrl: options.githubApiUrl,
    githubApp: options.githubApp,
    ...(options.githubSignInSleep ? { githubSignInSleep: options.githubSignInSleep } : {}),
    linearApiUrl: options.linearApiUrl,
    slackApiUrl: options.slackApiUrl,
    slackSignIn: options.slackSignIn,
    ...(options.slackNotifier ? { slackNotifier: options.slackNotifier } : {}),
    locateGh: options.locateGh ?? (async () => null),
    ...(options.deleteSettleMs === undefined ? {} : { deleteSettleMs: options.deleteSettleMs }),
    ...(options.openFolder ? { openFolder: options.openFolder } : {}),
    ...(options.cloneTest ? { cloneTest: options.cloneTest } : {}),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
    ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
  };
}

export function createTestApp(t: TestDb, options: TestAppOptions = {}) {
  return createApp(testAppOptions(t, options));
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
