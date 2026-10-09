import { describe, expect, it } from 'vitest';
import { FE_CHAT, WEB_PROJECT, chat } from '../test-fixtures.ts';
import { emptyChat } from './create-draft.ts';
import {
  API_PROJECT,
  CODEX,
  CODEX_CAPABILITIES,
  countingIds,
  existing,
  fresh,
} from './create-fixtures.ts';
import { agentView, chatView } from './create-labels.ts';

const CONTEXT = {
  chats: [chat(FE_CHAT, { title: 'Usage page', projectIds: [WEB_PROJECT] })],
  projectNames: { [WEB_PROJECT]: 'web', [API_PROJECT]: 'api' },
};

describe('the agent of a chat', () => {
  it('reads Auto for the default model and the mode by its own name', () => {
    expect(agentView(CODEX, CODEX_CAPABILITIES)).toMatchObject({
      agent: 'Codex Auto',
      mode: 'Approve for me',
      modeId: 'agent',
    });
  });

  it('shortens a picked model the way the message box does', () => {
    const picked = { ...CODEX, model: 'gpt-5', agentMode: 'read-only' };
    expect(agentView(picked, CODEX_CAPABILITIES)).toMatchObject({
      agent: 'Codex GPT-5',
      mode: 'Read-only',
      risk: 'read',
    });
  });

  it('is nothing without a connected agent', () => {
    expect(agentView({ provider: null, model: null, agentMode: null }, undefined)).toBeNull();
  });
});

describe('how a chat is shown in the list', () => {
  it('names a new chat after its project and keeps the face of the chat it will become', () => {
    const draft = fresh(countingIds(), API_PROJECT, 'api');
    const agent = agentView(draft, CODEX_CAPABILITIES);
    expect(chatView(draft, { ...CONTEXT, agent })).toEqual({
      faceId: draft.newChatId,
      title: 'New chat in api',
      tag: 'New',
      meta: 'api · Codex Auto · Approve for me',
    });
  });

  it('shows an existing chat by its title and project', () => {
    const draft = existing(countingIds(), FE_CHAT, 'fe');
    expect(chatView(draft, { ...CONTEXT, agent: null })).toEqual({
      faceId: FE_CHAT,
      title: 'Usage page',
      tag: 'Existing',
      meta: 'web',
    });
  });

  it('has words for a form with nothing picked yet', () => {
    const blank = emptyChat(CODEX, countingIds());
    expect(chatView(blank, { ...CONTEXT, agent: null })).toMatchObject({
      faceId: blank.key,
      title: 'Choose a chat',
    });
    expect(chatView({ ...blank, kind: 'new' }, { ...CONTEXT, agent: null }).title).toBe('New chat');
  });
});
