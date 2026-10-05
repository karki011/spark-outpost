import { describe, expect, it } from 'vitest';
import { parseAuthStatus } from './auth-status.ts';
import { codexUnlistedModels } from './codex-models.ts';

describe('the auth status an agent pushes', () => {
  it('reads the account kind, label and plan', () => {
    const pushed = {
      authStatus: {
        kind: 'account',
        label: 'ChatGPT Plus',
        account: { email: 'someone@example.com', plan: 'plus' },
      },
    };
    expect(parseAuthStatus(pushed)).toEqual({
      kind: 'account',
      label: 'ChatGPT Plus',
      plan: 'plus',
    });
    expect(parseAuthStatus({ authStatus: { kind: 'api_key', label: 'OpenAI API key' } })).toEqual({
      kind: 'api_key',
      label: 'OpenAI API key',
      plan: null,
    });
  });

  it('ignores a payload it does not understand and never keeps the email', () => {
    expect(parseAuthStatus({ authStatus: { kind: 'robot', label: 'x' } })).toBeNull();
    expect(parseAuthStatus({})).toBeNull();
    expect(parseAuthStatus(null)).toBeNull();
    const parsed = parseAuthStatus({
      authStatus: { kind: 'account', label: 'Claude Max', account: { email: 'a@b.c' } },
    });
    expect(JSON.stringify(parsed)).not.toContain('a@b.c');
  });
});

describe('a Codex model the account list does not contain', () => {
  const option = (currentValue: string, options: object[]) => ({
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select' as const,
    currentValue,
    options: options as { value: string; name: string; description?: string | null }[],
  });

  it('is the current model the adapter added without a description', () => {
    const options = [
      option('gpt-6.1-sol', [
        { value: 'gpt-6.1-sol', name: 'Gpt-6.1-sol', description: null },
        { value: 'gpt-6-sol', name: 'GPT-6 Sol', description: 'Complex coding' },
      ]),
    ];
    expect(codexUnlistedModels(options)).toEqual(['gpt-6.1-sol']);
  });

  it('is nothing when the current model is listed or no model is described', () => {
    const listed = option('gpt-6-sol', [
      { value: 'gpt-6-sol', name: 'GPT-6 Sol', description: 'x' },
    ]);
    expect(codexUnlistedModels([listed])).toEqual([]);
    const bare = option('a', [
      { value: 'a', name: 'A' },
      { value: 'b', name: 'B' },
    ]);
    expect(codexUnlistedModels([bare])).toEqual([]);
    expect(codexUnlistedModels([])).toEqual([]);
  });
});
