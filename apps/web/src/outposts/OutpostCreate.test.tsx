// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { OutpostCreate } from './OutpostCreate.tsx';
import { API_CHAT, FE_CHAT, chat, detail } from './test-fixtures.ts';

interface Call {
  method: string;
  path: string;
  body: { id: string; name: string; members: unknown[] };
}

let client: QueryClient;
let calls: Call[];

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversations, [
    chat(FE_CHAT, { title: 'Usage page' }),
    chat(API_CHAT, { title: 'Usage endpoint' }),
  ]);
  client.setQueryData(projectKeys.all, []);
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(new Response('[]', { status: 200 }));
      const body = JSON.parse(String(init.body)) as Call['body'];
      calls.push({ method: 'POST', path: url, body });
      const created = detail([], { id: body.id, name: body.name, members: [] });
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OutpostCreate', () => {
  it('starts with the chat it was opened from and creates the outpost under a new id', async () => {
    const onCreated = vi.fn<(outpostId: string) => void>();
    render(
      <QueryClientProvider client={client}>
        <OutpostCreate firstChatId={FE_CHAT} onCreated={onCreated} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const handle = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Handle for Usage page',
    });
    expect(handle.value).toBe('usage-page');
    fireEvent.change(handle, { target: { value: 'fe' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), {
      target: { value: ' Usage by user ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/outposts',
      body: { name: 'Usage by user', members: [{ conversationId: FE_CHAT, handle: 'fe' }] },
    });
    expect(calls[0]?.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(onCreated).toHaveBeenCalledWith(calls[0]?.body.id);
  });
});
