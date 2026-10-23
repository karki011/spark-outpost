// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOutpostRequest, FailedMember } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { API_PROJECT, project, seedCreateQueries } from './create/create-fixtures.ts';
import { OutpostCreate } from './OutpostCreate.tsx';
import { API_CHAT, FE_CHAT, chat, detail } from './test-fixtures.ts';

let client: QueryClient;
let requests: CreateOutpostRequest[];
let failures: FailedMember[][];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversations, [
    chat(FE_CHAT, { title: 'Usage page' }),
    chat(API_CHAT, { title: 'Usage endpoint' }),
  ]);
  client.setQueryData(projectKeys.all, [project(API_PROJECT, 'api')]);
  seedCreateQueries(client);
  requests = [];
  failures = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(new Response('[]', { status: 200 }));
      const body = JSON.parse(String(init.body)) as CreateOutpostRequest;
      requests.push(body);
      const created = {
        ...detail([], { id: body.id, name: body.name, members: [] }),
        failed: failures.shift() ?? [],
      };
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(onCreated = vi.fn<(outpostId: string) => void>(), firstChatId: string | null = null) {
  render(
    <QueryClientProvider client={client}>
      <OutpostCreate firstChatId={firstChatId} onCreated={onCreated} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return onCreated;
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

function nameIt(name: string) {
  const input = screen.getByRole('textbox', { name: /^Name/ });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function addNewChat() {
  fireEvent.click(screen.getByRole('radio', { name: 'New chat' }));
  fireEvent.click(button('Project'));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^api/ }));
}

describe('OutpostCreate', () => {
  it('starts with the chat it was opened from and creates the outpost under a new id', async () => {
    const onCreated = open(undefined, FE_CHAT);
    nameIt(' Usage by user ');
    const handle = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Handle for Usage page',
    });
    expect(handle.value).toBe('usage-page');
    fireEvent.change(handle, { target: { value: 'fe' } });
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      name: 'Usage by user',
      members: [{ conversationId: FE_CHAT, handle: 'fe' }],
    });
    expect(requests[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(onCreated).toHaveBeenCalledWith(requests[0]?.id, null);
  });

  it('sends a new chat with the default agent, its picked mode and a first message', async () => {
    const onCreated = open();
    nameIt('Usage by user');
    addNewChat();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle' }).value).toBe('api');
    expect(button('Agent: Codex GPT-5')).toBeTruthy();

    fireEvent.click(button('Permissions: Approve for me'));
    fireEvent.click(screen.getByRole('radio', { name: 'Read-only' }));
    expect(button('Permissions: Read-only')).toBeTruthy();

    fireEvent.click(button(/Add a first message/));
    fireEvent.change(screen.getByRole('textbox', { name: /^First message/ }), {
      target: { value: 'Add an optional userId filter.' },
    });
    fireEvent.click(button(/^Continue/));
    const review = screen.getByRole('region', { name: 'Review' });
    expect(within(review).getByText('api · Codex GPT-5 · Read-only')).toBeTruthy();
    fireEvent.click(button(/^Start outpost/));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(requests[0]?.members).toEqual([
      {
        new: {
          conversationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          projectId: API_PROJECT,
          provider: 'codex',
          model: null,
          agentMode: 'read-only',
        },
        handle: 'api',
        firstMessage: {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          text: 'Add an optional userId filter.',
          attachmentIds: [],
        },
      },
    ]);
  });

  it('picks a model for the new chat from the agent list', () => {
    open();
    nameIt('Usage by user');
    addNewChat();
    fireEvent.click(button('Agent: Codex GPT-5'));
    fireEvent.click(screen.getByRole('radio', { name: /^GPT-5/ }));
    expect(button('Agent: Codex GPT-5')).toBeTruthy();
  });

  it('shows a chat that could not be added and repeats the same request on Try again', async () => {
    const onCreated = open();
    failures = [[{ conversationId: API_CHAT, handle: 'api', message: 'The folder is missing.' }]];
    nameIt('Usage by user');
    addNewChat();
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Usage by user started. 1 thing did not work.',
    );
    expect(screen.getByText('The folder is missing.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(button(/^Try again/));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
});
