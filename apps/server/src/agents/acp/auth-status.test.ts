import type * as acp from '@agentclientprotocol/sdk/unstable';
import { toAcpAuthStatus } from '@agentclientprotocol/claude-agent-acp/dist/auth-status.js';
import { describe, expect, it } from 'vitest';
import { assertSignedIn, parseAuthStatus, parseStandardAuthStatus } from './auth-status.ts';
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

describe('the standard auth status an agent pushes', () => {
  it("reads the pinned Claude adapter's account with its kind and plan", () => {
    const pushed = toAcpAuthStatus({
      kind: 'account',
      label: 'Claude Max',
      account: { plan: 'max', email: 'a@b.c' },
    });
    const parsed = parseStandardAuthStatus(pushed);
    expect(parsed).toEqual({ kind: 'account', label: 'Claude Max', plan: 'max' });
    expect(JSON.stringify(parsed)).not.toContain('a@b.c');
  });

  it('reports a signed-out agent', () => {
    expect(
      parseStandardAuthStatus(toAcpAuthStatus({ kind: 'none', label: 'Not logged in' })),
    ).toEqual({ kind: 'none', label: 'Not logged in', plan: null });
  });

  it('keeps what it knows when the update names no account kind or state', () => {
    expect(parseStandardAuthStatus({ state: 'unknown' })).toBeNull();
    expect(parseStandardAuthStatus({ state: 'not_required' })).toBeNull();
    expect(
      parseStandardAuthStatus({ state: 'authenticated', accounts: [{ label: 'x' }] }),
    ).toBeNull();
    expect(parseStandardAuthStatus({ state: 'authenticated' })).toBeNull();
    expect(parseStandardAuthStatus(null)).toBeNull();
  });
});

function agent(auth: object | undefined): acp.InitializeResponse {
  return { protocolVersion: 1, agentCapabilities: auth ? { auth } : {} };
}

function asking(answer: () => unknown) {
  const methods: string[] = [];
  const ctx = {
    request: async (method: string) => {
      methods.push(method);
      return answer();
    },
  } as unknown as Pick<acp.ClientContext, 'request'>;
  return { ctx, methods };
}

describe('checking sign-in before a session', () => {
  it('stops with the sign-in message when the agent says it is signed out', async () => {
    const { ctx, methods } = asking(() => ({ state: 'unauthenticated' }));
    await expect(assertSignedIn(ctx, agent({ status: {} }), 'Claude')).rejects.toThrow(
      "Claude isn't signed in. Open Settings, reconnect Claude, and try again.",
    );
    expect(methods).toEqual(['auth/status']);
  });

  it('goes on for every other answer and when the request fails', async () => {
    for (const state of ['authenticated', 'not_required', 'unknown', 'someday']) {
      const { ctx } = asking(() => ({ state }));
      await expect(assertSignedIn(ctx, agent({ status: {} }), 'Claude')).resolves.toBeUndefined();
    }
    const { ctx } = asking(() => {
      throw new Error('no');
    });
    await expect(assertSignedIn(ctx, agent({ status: {} }), 'Claude')).resolves.toBeUndefined();
  });

  it('asks only an agent that advertises auth status', async () => {
    const { ctx, methods } = asking(() => ({ state: 'unauthenticated' }));
    await assertSignedIn(ctx, agent(undefined), 'Codex');
    await assertSignedIn(ctx, agent({ logout: {} }), 'Codex');
    expect(methods).toEqual([]);
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
