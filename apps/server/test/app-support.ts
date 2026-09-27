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

export interface TestAppOptions {
  fetch?: typeof fetch;
  runCommand?: RunCommand;
  secrets?: SecretStore;
  fixedRunProvider?: string | null;
  probeCapabilities?: AppOptions['probeCapabilities'];
}

const unavailableProbe: AppOptions['probeCapabilities'] = () =>
  Promise.reject(new Error('Capability probes are disabled in tests'));

const notFound: CommandResult = { code: 1, stdout: '', stderr: '' };

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
    secrets: options.secrets ?? memorySecretStore(),
    endpoints: {
      anthropicBaseUrl: 'https://anthropic.test',
      openaiBaseUrl: 'https://openai.test',
      typesafeBaseUrl: 'https://typesafe.test',
      zaiBaseUrl: 'https://zai.test',
      fetch: options.fetch ?? (() => Promise.reject(new Error('Network disabled in tests'))),
    },
    runCommand: options.runCommand ?? (async () => notFound),
    terminals: new TerminalSessions(loginShellSpawner('/bin/sh')),
    loginShell: '/bin/zsh',
    probeCapabilities: options.probeCapabilities ?? unavailableProbe,
  });
}
