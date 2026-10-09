// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outpostKeys } from '../../outposts/outposts-api.ts';
import {
  API_CHAT,
  FE_CHAT,
  OUTPOST_ID,
  detail,
  outpost,
  post,
} from '../../outposts/test-fixtures.ts';
import { chatDraftsQuery, type ChatDraft } from './chat-drafts.ts';
import type { TurnWindow } from './chat-lines.ts';
import { OutpostSeamContext, type OutpostSeam } from './outpost-seam.ts';
import { TurnOutpostLines } from './TurnOutpostLines.tsx';

const RUN_ID = '0e000000-0000-4000-8000-000000000001';
const DRAFT_ID = '0f000000-0000-4000-8000-000000000001';
const RUN: TurnWindow = {
  id: RUN_ID,
  createdAt: '2026-10-09T10:00:00.000Z',
  startedAt: '2026-10-09T10:00:00.000Z',
  finishedAt: '2026-10-09T10:30:00.000Z',
  parentRunId: null,
};
const MEMBER = { id: FE_CHAT, outpost: { id: OUTPOST_ID, name: 'Usage by user', handle: 'fe' } };

let client: QueryClient;
let fetched: string[];

function seam(overrides: Partial<OutpostSeam> = {}): OutpostSeam {
  return {
    outposts: [outpost()],
    openOutpostId: null,
    canManage: true,
    onOpenOutpost: vi.fn(),
    onNewOutpost: vi.fn(),
    onAddToOutpost: vi.fn(),
    ...overrides,
  };
}

function draft(overrides: Partial<ChatDraft> = {}): ChatDraft {
  return {
    id: DRAFT_ID,
    runId: RUN_ID,
    chats: 3,
    stacked: 0,
    outpostId: null,
    startedAt: null,
    ...overrides,
  };
}

function seedDrafts(drafts: ChatDraft[]): void {
  client.setQueryData(chatDraftsQuery(FE_CHAT).queryKey, { drafts });
}

function renderLines(
  value: OutpostSeam | null,
  conversation: Parameters<typeof TurnOutpostLines>[0]['conversation'] = MEMBER,
  run = RUN,
) {
  return render(
    <QueryClientProvider client={client}>
      <OutpostSeamContext value={value}>
        <TurnOutpostLines conversation={conversation} run={run} />
      </OutpostSeamContext>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      fetched.push(String(input));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TurnOutpostLines', () => {
  it('lists the requests the turn sent and opens the outpost at one', () => {
    const sent = post(5, {
      fromUser: false,
      fromConversationId: FE_CHAT,
      fromHandle: 'fe',
      body: 'Which fields does the order have?',
      state: 'working',
    });
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([post(4), sent]));
    const value = seam();
    const { container } = renderLines(value);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.textContent).toContain('To @apiWhich fields does the order have?Working');
    fireEvent.click(
      screen.getByRole('button', { name: 'Open the request to @api in the outpost' }),
    );
    expect(value.onOpenOutpost).toHaveBeenCalledWith(OUTPOST_ID, sent.id);
  });

  it('draws nothing and asks for nothing in a chat that is in no outpost', () => {
    const { container } = renderLines(seam(), { id: API_CHAT });
    expect(container.textContent).toBe('');
    expect(fetched).toEqual([]);
  });

  it('does not ask for drafts until the app can open one', () => {
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([]));
    seedDrafts([draft()]);
    const { container } = renderLines(seam());
    expect(container.textContent).toBe('');
    expect(fetched).toEqual([]);
  });

  it('shows a proposed draft and opens it for review', () => {
    const onOpenDraft = vi.fn();
    client.setQueryData(chatDraftsQuery(API_CHAT).queryKey, { drafts: [draft({ stacked: 1 })] });
    renderLines(seam({ onOpenDraft }), { id: API_CHAT });
    expect(screen.getByText('Proposed 3 chats · 1 stacked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review and start' }));
    expect(onOpenDraft).toHaveBeenCalledWith(DRAFT_ID);
  });

  it('offers no review where chats cannot be created', () => {
    seedDrafts([draft()]);
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([]));
    renderLines(seam({ onOpenDraft: vi.fn(), canManage: false }));
    expect(screen.getByText('Review and start on your Mac')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Started with the outpost name and opens that outpost', () => {
    seedDrafts([draft({ outpostId: OUTPOST_ID, startedAt: '2026-10-09T10:40:00.000Z' })]);
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([]));
    const value = seam({ onOpenDraft: vi.fn() });
    const { container } = renderLines(value);
    expect(container.textContent).toBe('Started 3 chatsUsage by userOpen outpost');
    fireEvent.click(screen.getByRole('button', { name: 'Open outpost Usage by user' }));
    expect(value.onOpenOutpost).toHaveBeenCalledWith(OUTPOST_ID);
  });

  it('keeps a draft under the turn that proposed it', () => {
    seedDrafts([draft({ runId: '0e000000-0000-4000-8000-000000000009' })]);
    client.setQueryData(outpostKeys.detail(OUTPOST_ID), detail([]));
    const { container } = renderLines(seam({ onOpenDraft: vi.fn() }));
    expect(container.textContent).toBe('');
  });
});
