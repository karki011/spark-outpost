import { describe, expect, it } from 'vitest';
import type { ChatSharePreview, ConversationSummary } from '@spark-outpost/contracts';
import { projectSummary, sharedChatView, summaryChatView } from './shared-chat.ts';

const ID = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';

const preview: ChatSharePreview = {
  id: ID,
  link: `spark-outpost://chat/${ID}`,
  title: 'Fix the login page',
  projects: ['web'],
  state: 'working',
  archived: false,
  asOf: '2026-10-04T10:00:00.000Z',
};

function chat(changes: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: ID,
    title: 'Fix the login page',
    updatedAt: preview.asOf,
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...changes,
  };
}

const run = (status: 'running' | 'succeeded') => ({
  id: ID,
  status,
  error: null,
  step: null,
  provider: null,
  progress: null,
});

describe('sharedChatView', () => {
  it('shows what the server saw until the chat list has loaded', () => {
    expect(sharedChatView(preview, undefined)).toEqual({
      title: 'Fix the login page',
      project: 'web',
      tone: 'working',
      state: 'Running',
    });
  });

  it('follows the other chat as it finishes, waits, is renamed or archived', () => {
    const done = sharedChatView(preview, [chat({ latestRun: run('succeeded'), title: 'Login' })]);
    const waiting = sharedChatView(preview, [
      chat({ latestRun: run('running'), needsInput: true }),
    ]);
    const archived = sharedChatView(preview, [chat({ archivedAt: preview.asOf })]);

    expect(done).toMatchObject({ title: 'Login', tone: 'done', state: 'Done' });
    expect(waiting).toMatchObject({ tone: 'needs_you', state: 'Waiting for you' });
    expect(archived).toMatchObject({ tone: 'archived', state: 'Archived' });
  });

  it('says a chat was deleted once it leaves the list, and names a chat with no project', () => {
    expect(sharedChatView({ ...preview, projects: [] }, [])).toMatchObject({
      project: 'No project',
      tone: 'deleted',
      state: 'Deleted',
    });
  });
});

describe('summaryChatView', () => {
  it('names an untitled chat the way the sidebar does and lists every project', () => {
    expect(summaryChatView(chat({ title: '  ' }), ['web', 'api'])).toMatchObject({
      title: 'New chat',
      project: 'web, api',
    });
  });
});

describe('projectSummary', () => {
  it('shows the first project and counts the rest', () => {
    expect(projectSummary([])).toEqual({ name: 'No project', more: null });
    expect(projectSummary(['web'])).toEqual({ name: 'web', more: null });
    expect(projectSummary(['web', 'api', 'docs'])).toEqual({ name: 'web', more: '+2' });
  });
});
