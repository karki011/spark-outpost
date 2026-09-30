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

  it('asks the Claude CLI with the cheapest model the harness still uses', async () => {
    const calls: string[][] = [];
    const run: RunCommand = async (file, args) => {
      if (file === '/usr/bin/which')
        return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      calls.push(args);
      return {
        code: 0,
        stdout: JSON.stringify({ result: 'OK', modelUsage: { 'claude-haiku-4-5': {} } }),
        stderr: '',
      };
    };
    const models = [
      { id: 'haiku', label: 'Haiku 4.5' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'opus', label: 'Opus 5.5' },
    ];
    await sendTestMessage(
      'claude',
      { ...connection, models },
      {
        run,
        loginShell: null,
        endpoints: {} as never,
        secrets: memorySecretStore(),
      },
    );
    expect(calls[0]).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    await sendTestMessage('claude', connection, {
      run,
      loginShell: null,
      endpoints: {} as never,
      secrets: memorySecretStore(),
    });
    expect(calls[1]).not.toContain('--model');
  });
});
