import { describe, expect, it } from 'vitest';
import type { ProviderConnection } from '@spark-outpost/contracts';
import type { RunCommand } from './command.ts';
import { memorySecretStore } from './secrets.ts';
import { sendTestMessage } from './test-message.ts';

const KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv';

const connection = {
  method: 'cli',
  detail: 'claude 1.0',
  summary: null,
  lastTest: null,
  models: [],
  model: null,
  permission: 'ask',
  agentMode: null,
  level: 'balanced',
  effort: null,
  verifiedAt: '2026-09-28T00:00:00.000Z',
} as ProviderConnection;

describe('sendTestMessage', () => {
  it('redacts secrets the CLI prints when the test message fails', async () => {
    const run: RunCommand = async (file) =>
      file === '/usr/bin/which'
        ? { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' }
        : { code: 1, stdout: '', stderr: `Invalid API key ${KEY}` };
    const outcome = await sendTestMessage('claude', connection, {
      run,
      loginShell: null,
      endpoints: {} as never,
      secrets: memorySecretStore(),
    });
    expect(outcome).toEqual({
      ok: false,
      message: 'The test message failed: Invalid API key [redacted:api_key]',
    });
  });
});
