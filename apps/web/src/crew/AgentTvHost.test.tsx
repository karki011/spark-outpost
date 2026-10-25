// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentTvHost } from './AgentTvHost.tsx';
import { queryKeys } from '../api/client.ts';
import { outpostKeys } from '../outposts/outposts-api.ts';
import { queueDraftAfterTyped } from '../chat/composer/pending-draft.ts';

vi.mock('./agent-tv-store.ts', () => ({
  useAgentTv: () => ({ sourceId: 'builder-chat' }),
  closeAgentTv: vi.fn(),
}));
vi.mock('../chat/composer/pending-draft.ts', () => ({
  queueDraftAfterTyped: vi.fn(),
  requestComposerFocus: vi.fn(),
}));
vi.mock('./conversation-crew.ts', () => ({
  tvCast: () => ({ run: { id: 'run' }, subagents: [], sparks: [] }),
  castAgents: () => [],
  agentAnchor: vi.fn(),
  approvalAnchor: vi.fn(),
}));
vi.mock('./tv-list.ts', () => ({ tvListRows: () => [] }));
vi.mock('./tv-scene.ts', () => ({ pendingAsks: () => [] }));
vi.mock('./AgentTv.tsx', () => ({
  AgentTv: ({
    messageChats,
    onMessage,
    onRedirect,
  }: {
    messageChats: { conversationId: string; name: string }[];
    onMessage(id: string): void;
    onRedirect(row: { id: string; name: string; task: string }): void;
  }) => (
    <>
      {messageChats.map((chat) => (
        <button key={chat.conversationId} onClick={() => onMessage(chat.conversationId)}>
          Message {chat.name}
        </button>
      ))}
      <button onClick={() => onRedirect({ id: 'worker', name: 'Verifier', task: 'Test changes' })}>
        Redirect worker
      </button>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('messages the named Outpost chat and redirects native workers to their owning member', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversation('builder-chat'), {
    conversation: { outpost: { id: 'outpost', handle: 'builder' } },
  });
  client.setQueryData(outpostKeys.detail('outpost'), {
    outpost: {
      members: [
        { conversationId: 'lead-chat', handle: 'lead' },
        { conversationId: 'builder-chat', handle: 'builder' },
      ],
    },
  });
  const onGoTo = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AgentTvHost activeId="builder-chat" onGoTo={onGoTo} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Message lead' }));
  expect(onGoTo).toHaveBeenLastCalledWith('lead-chat');
  fireEvent.click(screen.getByRole('button', { name: 'Message builder' }));
  expect(onGoTo).toHaveBeenLastCalledWith('builder-chat');
  fireEvent.click(screen.getByRole('button', { name: 'Redirect worker' }));
  expect(onGoTo).toHaveBeenLastCalledWith('builder-chat');
  expect(queueDraftAfterTyped).toHaveBeenCalledWith(
    'builder-chat',
    'Please redirect the sub-agent Verifier (worker) working on Test changes: ',
  );
  client.clear();
});

it('keeps the session lead destination for a standalone chat', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversation('builder-chat'), { conversation: {} });
  const onGoTo = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AgentTvHost activeId="builder-chat" onGoTo={onGoTo} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Message lead' }));
  expect(onGoTo).toHaveBeenCalledWith('builder-chat');
  client.clear();
});
