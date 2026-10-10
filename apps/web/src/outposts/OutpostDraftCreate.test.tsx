// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOutpostRequest, DraftChat } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { projectKeys } from '../api/projects.ts';
import {
  API_PROJECT,
  STORY_DRAFT_ID,
  project,
  seedCreateQueries,
} from './create/create-fixtures.ts';
import { OutpostCreate } from './OutpostCreate.tsx';
import { outpostKeys, type ProposedDraft } from './outposts-api.ts';
import { DOCS_CHAT, FE_CHAT, OUTPOST_ID, chat, detail, member, outpost } from './test-fixtures.ts';

let client: QueryClient;
let requests: CreateOutpostRequest[];

function proposed(handle: string, overrides: Partial<DraftChat> = {}): DraftChat {
  return {
    handle,
    title: `Build ${handle}`,
    projectId: API_PROJECT,
    task: `Do the ${handle} part.`,
    ...overrides,
  };
}

function seedDraft(overrides: Partial<ProposedDraft> = {}, chats?: DraftChat[]): void {
  const draft: ProposedDraft = {
    id: STORY_DRAFT_ID,
    conversationId: DOCS_CHAT,
    outpostId: null,
    body: {
      name: 'Orders launch',
      title: 'Checkout',
      chats: chats ?? [proposed('api'), proposed('fe', { dependsOn: 'api' })],
    },
    startedAt: null,
    ...overrides,
  };
  client.setQueryData(outpostKeys.draft(STORY_DRAFT_ID), draft);
}

function seedLead(agentMode: string | null, inOutpost = false): void {
  client.setQueryData(queryKeys.conversations, [
    chat(FE_CHAT, { title: 'Usage page' }),
    chat(DOCS_CHAT, {
      title: 'Checkout plan',
      ...(inOutpost ? { outpost: { id: OUTPOST_ID, name: 'Usage by user', handle: 'lead' } } : {}),
    }),
  ]);
  client.setQueryData(queryKeys.conversation(DOCS_CHAT), {
    settings: { provider: 'codex', model: null, routing: 'auto', agentMode },
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(projectKeys.all, [project(API_PROJECT, 'api')]);
  client.setQueryData(outpostKeys.list, []);
  seedCreateQueries(client);
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return Promise.resolve(new Response('{"error":"Not found."}', { status: 404 }));
      }
      const body = JSON.parse(String(init.body)) as CreateOutpostRequest;
      requests.push(body);
      const created = { ...detail([], { id: body.id, name: body.name, members: [] }), failed: [] };
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(onCreated = vi.fn<(outpostId: string) => void>(), onClose = vi.fn<() => void>()) {
  render(
    <QueryClientProvider client={client}>
      <OutpostCreate draftId={STORY_DRAFT_ID} onCreated={onCreated} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onCreated, onClose };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

function newChats(): Extract<CreateOutpostRequest['members'][number], { new: unknown }>[] {
  return (requests[0]?.members ?? []).flatMap((entry) => ('new' in entry ? [entry] : []));
}

describe('OutpostCreate from a draft a chat proposed', () => {
  it('starts the proposed chats under the draft, with the lead and the starts-after edge', async () => {
    seedDraft();
    seedLead('agent');
    const { onCreated } = open();
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /^Name/ });
    expect(name.value).toBe('Orders launch');
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const request = requests[0]!;
    expect(request.draftId).toBe(STORY_DRAFT_ID);
    expect(request.name).toBe('Orders launch');
    expect(request.members[0]).toEqual({ conversationId: DOCS_CHAT, handle: 'checkout-plan' });
    const [api, fe] = newChats();
    expect(api).toMatchObject({
      handle: 'api',
      firstMessage: { text: 'Do the api part.' },
      new: { projectId: API_PROJECT, provider: 'codex', agentMode: 'agent' },
    });
    expect(api && 'dependsOn' in api).toBe(false);
    expect(fe?.dependsOn).toBe(api?.new.conversationId);
  });

  it('never prefills a mode above the lead', async () => {
    seedDraft({}, [proposed('api')]);
    seedLead('read-only');
    open();
    const name = await screen.findByRole('textbox', { name: /^Name/ });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(screen.getByText('api · Codex Auto · Read-only')).toBeTruthy();
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(newChats()[0]?.new.agentMode).toBe('read-only');
  });

  it('sends a mode above the lead only when the user picks it in the sheet', async () => {
    seedDraft({}, [proposed('api')]);
    seedLead('read-only');
    open();
    fireEvent.keyDown(await screen.findByRole('textbox', { name: /^Name/ }), { key: 'Enter' });
    fireEvent.click(button('Edit Build api'));
    fireEvent.click(button('Permissions: Read-only'));
    fireEvent.click(screen.getByRole('radio', { name: 'Approve for me' }));
    fireEvent.click(button('Done'));
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(newChats()[0]?.new.agentMode).toBe('agent');
  });

  it('keeps the open sheet when the draft and its lead change or fail to refresh', async () => {
    seedDraft({}, [proposed('api')]);
    seedLead('agent');
    const { onCreated } = open();
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /^Name/ });
    fireEvent.change(name, { target: { value: 'Typed by hand' } });
    await client.invalidateQueries({ queryKey: queryKeys.conversation(DOCS_CHAT) });
    await client.invalidateQueries({ queryKey: outpostKeys.all });
    seedDraft({ startedAt: '2026-10-09T10:00:00.000Z', outpostId: OUTPOST_ID });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ }).value).toBe(
      'Typed by hand',
    );
    expect(screen.getByRole('dialog', { name: 'New outpost' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('adds the chats to the outpost the lead is already in, under its id and name', async () => {
    seedDraft({}, [proposed('api')]);
    seedLead('agent', true);
    client.setQueryData(outpostKeys.list, [outpost({ members: [member(DOCS_CHAT, 'lead', 1)] })]);
    const { onCreated } = open();
    const dialog = await screen.findByRole('dialog', { name: 'Add chats to Usage by user' });
    expect(within(dialog).getAllByRole('textbox', { name: /^Handle for/ })).toHaveLength(1);
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start chats/));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(OUTPOST_ID));
    expect(requests[0]).toMatchObject({
      id: OUTPOST_ID,
      name: 'Usage by user',
      draftId: STORY_DRAFT_ID,
    });
    expect(requests[0]?.members.map((entry) => entry.handle)).toEqual(['api']);
  });

  it('opens the outpost of a draft that was already started', async () => {
    seedDraft({ startedAt: '2026-10-09T10:00:00.000Z', outpostId: OUTPOST_ID });
    seedLead('agent');
    const { onCreated } = open();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(OUTPOST_ID));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when the proposing chat was deleted, and closes', async () => {
    seedDraft({ conversationId: null });
    const { onClose } = open();
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This draft cannot be started',
    });
    expect(dialog.textContent).toContain('The chat that proposed this draft was deleted');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when the draft no longer exists', async () => {
    seedLead('agent');
    open();
    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      'That draft no longer exists.',
    );
  });

  it('says so when the outpost the draft belongs to was deleted', async () => {
    seedDraft({ outpostId: OUTPOST_ID });
    seedLead('agent');
    open();
    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      'The outpost this draft belongs to was deleted.',
    );
  });
});
