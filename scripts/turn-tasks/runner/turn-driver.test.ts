import { describe, expect, it } from 'vitest';
import type { Api } from '../instance/api.ts';
import { TASKS } from '../tasks/index.ts';
import { LOCAL_ONLY_RULE } from '../tasks/prompt.ts';
import { DEFAULT_EFFORT } from './driver.ts';
import { PROVIDERS, PROVIDER_SETUPS, providerNamed } from './providers.ts';
import { turnDriver, type DriverParts } from './turn-driver.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeApi() {
  const calls: Call[] = [];
  const api = {
    async call(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body });
      if (path === '/projects') return { id: 'project-1' };
      if (path.endsWith('/messages')) return { run: { id: 'run-1' } };
      return {};
    },
    finished: async () => true,
    pending: async () => [],
    cancel: async () => undefined,
  };
  return { calls, api: api as unknown as Api };
}

function parts(api: Api): DriverParts {
  return { api, db: null as unknown as DriverParts['db'], close: async () => undefined };
}

describe('the providers', () => {
  it('are Claude, Codex and Z.ai, each with a mode that works alone and one that asks', () => {
    expect(PROVIDERS).toEqual(['claude', 'codex', 'zai']);
    expect(PROVIDER_SETUPS.claude.modes).toEqual({ auto: 'auto', ask: 'default' });
    expect(PROVIDER_SETUPS.codex.modes).toEqual({ auto: 'agent', ask: 'ask-every-action' });
    expect(PROVIDER_SETUPS.zai.modes).toEqual({ auto: 'auto', ask: 'default' });
    expect(providerNamed('codex')).toBe('codex');
    expect(() => providerNamed('direct')).toThrow('Unknown provider direct');
  });
});

describe('a chat on the single-session turn', () => {
  it.each(PROVIDERS)(
    'opens a %s chat in the scratch checkout that keeps its changes',
    async (id) => {
      const { calls, api } = fakeApi();
      const choice = { provider: id, model: PROVIDER_SETUPS[id].model, effort: DEFAULT_EFFORT };
      const driver = turnDriver(parts(api), choice);
      const chat = await driver.openChat('/tmp/scratch/repo', driver.setupFor('auto'));
      expect(calls[0]).toEqual({
        method: 'POST',
        path: '/projects',
        body: { rootPath: chat.repo },
      });
      expect(calls[1]!.body).toEqual({ workPlace: 'checkout' });
      expect(calls[2]).toEqual({
        method: 'PATCH',
        path: `/conversations/${chat.conversationId}/settings`,
        body: {
          projectIds: ['project-1'],
          provider: id,
          level: 'hands-off',
          routing: 'pinned',
          model: PROVIDER_SETUPS[id].model,
          effort: 'high',
          agentMode: PROVIDER_SETUPS[id].modes.auto,
        },
      });
    },
  );

  it('sends the task prompt as typed, with the local-only rule, and returns the run', async () => {
    const { calls, api } = fakeApi();
    const driver = turnDriver(parts(api), { provider: 'claude', model: 'sonnet', effort: 'high' });
    const chat = { conversationId: 'chat-1', repo: '/tmp/scratch/repo' };
    for (const task of TASKS) {
      expect(await driver.send(chat, task.prompt)).toBe('run-1');
      const sent = calls.at(-1)!.body as { content: string; source: string };
      expect(sent.content).toBe(task.prompt);
      expect(sent.content).toContain(LOCAL_ONLY_RULE);
      expect(sent.source).toBe('bench');
    }
  });

  it('answers a card once, for the payload it saw', async () => {
    const { calls, api } = fakeApi();
    const driver = turnDriver(parts(api), { provider: 'codex', model: 'm', effort: 'high' });
    await driver.decide({ id: 'card-1', payloadHash: 'hash-1' } as never, 'allow');
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/approvals/card-1/decision',
      body: { optionId: 'allow', scope: 'once', payloadHash: 'hash-1' },
    });
  });
});
