import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import type { OutpostDetail } from '@spark-outpost/contracts';
import type { api } from '../api/client.ts';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import { OutpostView } from './OutpostView.tsx';
import { outpostKeys } from './outposts-api.ts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, chat, post } from './test-fixtures.ts';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

export const SENT = {} as Awaited<ReturnType<typeof api.sendMessage>>;

export let client: QueryClient;
export let calls: Call[];
let served: OutpostDetail | null;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

export function setUpOutpostView(): void {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.conversations, [
      chat(FE_CHAT, { title: 'Usage page' }),
      chat(API_CHAT, { title: 'Usage endpoint' }),
    ]);
    client.setQueryData(projectKeys.all, []);
    calls = [];
    served = null;
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', QuietResizeObserver);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method !== 'GET') {
          const body = JSON.parse(String(init?.body ?? 'null')) as {
            id?: string;
            instructions?: string;
          };
          calls.push({ method, path: url, body });
          if (served && url.endsWith('/instructions')) {
            served = {
              ...served,
              outpost: { ...served.outpost, instructions: body.instructions ?? '' },
            };
            return Promise.resolve(json(served));
          }
          if (served && body.id && url.endsWith('/posts')) {
            const stored = post(9, { id: body.id, body: 'add the filter' });
            served = { ...served, posts: [...served.posts, stored] };
          }
          return Promise.resolve(json({}));
        }
        if (url === `/api/outposts/${OUTPOST_ID}` && served) return Promise.resolve(json(served));
        return Promise.resolve(json({ error: 'Outpost not found.' }, 404));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export function view(onOpenChat = vi.fn<(id: string) => void>(), onGone = vi.fn<() => void>()) {
  return render(
    <QueryClientProvider client={client}>
      <OutpostView id={OUTPOST_ID} onOpenChat={onOpenChat} onGone={onGone} />
    </QueryClientProvider>,
  );
}

export function show(data: OutpostDetail): void {
  served = data;
  client.setQueryData(outpostKeys.detail(OUTPOST_ID), data);
}
