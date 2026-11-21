// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Approval,
  PlannedSubChat,
  ProviderCapabilities,
  StartSubChatsAction,
} from '@spark-outpost/contracts';
import { api } from '../../api/client.ts';
import { approvalsApi } from '../../api/approvals.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { subChatsPlanEdits } from './SubChatsPlanFacts.tsx';

const API_PIECE = '0a100000-0000-4000-8000-000000000001';
const UI_PIECE = '0a100000-0000-4000-8000-000000000002';
const TESTS_PIECE = '0a100000-0000-4000-8000-000000000003';

function piece(conversationId: string, title: string, extra: Partial<PlannedSubChat>) {
  const planned: PlannedSubChat = {
    conversationId,
    title,
    task: `Build ${title}.`,
    project: { id: '0b100000-0000-4000-8000-000000000001', name: 'storefront' },
    provider: 'claude',
    agentName: 'Claude',
    model: 'opus',
    effort: 'high',
    agentMode: 'default',
    level: 'full-auto',
    sameAsParent: true,
    stackedOn: null,
    startsAfter: [],
    ...extra,
  };
  return planned;
}

const action: StartSubChatsAction = {
  action: 'start_sub_chats',
  parent: { id: '0c100000-0000-4000-8000-000000000001', title: 'Checkout rewrite' },
  pieces: [
    piece(API_PIECE, 'Payments API', {}),
    piece(UI_PIECE, 'Checkout UI', { stackedOn: API_PIECE, model: 'sonnet', sameAsParent: false }),
    piece(TESTS_PIECE, 'E2E tests', { startsAfter: [API_PIECE, UI_PIECE] }),
  ],
};

const approval: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'spark:start_sub_chats:1',
  kind: 'spark_action',
  title: 'Start 3 sub-chats?',
  payload: {
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    sparkAction: action,
  },
  payloadHash: 'sha256:abc',
  options: [
    { optionId: 'confirm', name: 'Start', kind: 'allow_once' },
    { optionId: 'decline', name: 'Discard', kind: 'reject_once' },
  ],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-11-20T10:00:00.000Z',
};

const CAPABILITIES = {
  models: [
    { id: 'opus', label: 'Opus 5.5' },
    { id: 'sonnet', label: 'Sonnet 5.5' },
    { id: 'haiku', label: 'Haiku 5.5' },
  ],
  efforts: [
    { id: 'default', label: 'Default' },
    { id: 'low', label: 'Low' },
    { id: 'high', label: 'High' },
  ],
  modes: [],
} as unknown as ProviderCapabilities;

beforeEach(() => {
  vi.spyOn(api, 'getCapabilities').mockResolvedValue(CAPABILITIES);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApprovalCard approval={approval} provider="claude" agent="Claude" repo={null} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name: /^Start 3 sub-chats\?/ });
}

async function choose(card: HTMLElement, picker: string, choice: RegExp) {
  const button = await within(card).findByRole('button', { name: picker });
  fireEvent.click(button);
  const menu = await screen.findByRole('menu', { name: picker });
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: choice }));
}

describe('the sub-chats plan card', () => {
  it('lists each piece with its number, placement and settings', async () => {
    const card = show();
    const rows = within(
      within(card).getByRole('list', { name: 'Sub-chats to start' }),
    ).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      'Payments API',
      'Checkout UI',
      'E2E tests',
    ]);
    expect(rows[0]?.textContent).toContain('storefront · New branch');
    expect(rows[0]?.textContent).toContain('Same as this chat');
    expect(rows[1]?.textContent).toContain('Stacked on 1');
    await waitFor(() =>
      expect(rows[1]?.textContent).toContain('Claude · Sonnet 5.5 · high effort'),
    );
    expect(rows[2]?.textContent).toContain('Starts after 1, 2');
    expect(card.textContent).toContain('Claude wants to split this work into 3 sub-chats.');
  });

  it('keeps the task texts folded until Show each task', () => {
    const card = show();
    expect(card.textContent).not.toContain('Build Checkout UI.');
    const toggle = within(card).getByRole('button', { name: 'Show each task ›' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(card.textContent).toContain('Build Checkout UI.');
    expect(within(card).getByRole('button', { name: 'Hide each task' })).toBeTruthy();
  });

  it('shows the pickers only while Edit is on, between Start and Discard', async () => {
    const card = show();
    expect(within(card).queryByRole('button', { name: 'Model for Payments API' })).toBeNull();
    const answers = [...card.querySelectorAll('.appr-acts button')].map((each) => each.textContent);
    expect(answers).toEqual(['Start', 'Edit', 'Discard']);
    const edit = within(card).getByRole('button', { name: 'Edit' });
    expect(edit.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(edit);
    expect(edit.getAttribute('aria-pressed')).toBe('true');
    expect(
      await within(card).findByRole('group', { name: 'Model and effort for Payments API' }),
    ).toBeTruthy();
    expect((await within(card).findAllByRole('button', { name: /^Effort for / })).length).toBe(3);
    fireEvent.click(edit);
    expect(within(card).queryByRole('button', { name: 'Model for Payments API' })).toBeNull();
  });

  it('sends only the pieces whose model or effort changed, with Start', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    const card = show();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    await choose(card, 'Model for E2E tests', /^Haiku 5\.5/);
    await choose(card, 'Effort for E2E tests', /^Low/);
    await choose(card, 'Model for Checkout UI', /^Haiku 5\.5/);
    await choose(card, 'Model for Checkout UI', /^Sonnet 5\.5/);
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(card.textContent).toContain('Claude · Haiku 5.5 · low effort'));
    fireEvent.click(within(card).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith(approval.id, {
      optionId: 'confirm',
      scope: 'once',
      payloadHash: 'sha256:abc',
      edits: { subChats: [{ id: TESTS_PIECE, model: 'haiku', effort: 'low' }] },
    });
  });

  it('sends no edits with Start when nothing changed, and none with Discard', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    const card = show();
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    await choose(card, 'Model for Payments API', /^Haiku 5\.5/);
    fireEvent.click(within(card).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith(approval.id, {
      optionId: 'decline',
      scope: 'once',
      payloadHash: 'sha256:abc',
    });
  });

  it('builds the edits from changes alone', () => {
    expect(subChatsPlanEdits(action, [])).toEqual({});
    expect(subChatsPlanEdits(action, [{ id: API_PIECE, model: 'opus', effort: 'high' }])).toEqual(
      {},
    );
    expect(subChatsPlanEdits(action, [{ id: API_PIECE, model: 'opus', effort: 'low' }])).toEqual({
      subChats: [{ id: API_PIECE, effort: 'low' }],
    });
    expect(
      subChatsPlanEdits(
        { action: 'stop_sub_chat', parent: action.parent, subChat: action.parent },
        [{ id: API_PIECE, model: 'haiku' }],
      ),
    ).toEqual({});
  });
});
