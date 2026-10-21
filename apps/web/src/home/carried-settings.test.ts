import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationDetail, ProviderSetup } from '@spark-outpost/contracts';
import { api, newDraftId } from '../api/client.ts';
import { carriedSettings, isStartedChat } from './carried-settings.ts';

const PROJECT = '0b8e7f4c-1d2a-4e5b-8c9d-0a1b2c3d4e5f';
const DEFAULTS = {
  provider: 'claude',
  model: null,
  effort: null,
  permission: 'ask',
  agentMode: null,
  level: null,
  options: {},
};

async function draftDetail(): Promise<ConversationDetail> {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(DEFAULTS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
  return api.getConversation(newDraftId());
}

const providers: ProviderSetup[] = [];

afterEach(() => vi.unstubAllGlobals());

describe('settings carried into the next Home draft', () => {
  it('carries the project, mode and level the user picked', async () => {
    const detail = await draftDetail();
    detail.conversation.projectIds = [PROJECT];
    detail.settings = { ...detail.settings, agentMode: 'default', level: 'hands-off' };
    expect(carriedSettings(detail, providers)).toEqual({
      projectIds: [PROJECT],
      provider: 'claude',
      agentMode: 'default',
      level: 'hands-off',
    });
  });

  it('leaves the project out when none was picked', async () => {
    const detail = await draftDetail();
    expect(carriedSettings(detail, providers)).toEqual({ provider: 'claude' });
  });

  it('carries nothing from a teammate chat', async () => {
    const detail = await draftDetail();
    detail.conversation.teammate = { id: 'scout', name: 'Scout' } as never;
    expect(carriedSettings(detail, providers)).toBeNull();
  });

  it('tells a started chat from an unsent draft', async () => {
    const detail = await draftDetail();
    expect(isStartedChat(detail)).toBe(false);
    detail.messages = [{} as never];
    expect(isStartedChat(detail)).toBe(true);
  });
});
