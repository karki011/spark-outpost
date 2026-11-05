// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, StartOutpostAction } from '@spark-outpost/contracts';
import { OutpostSeamContext, type OutpostSeam } from '../outpost/outpost-seam.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(cleanup);

const DRAFT_ID = '0e100000-0000-4000-8000-000000000001';

const action: StartOutpostAction = {
  action: 'start_outpost',
  draftId: DRAFT_ID,
  outpostName: 'Docs split',
  joining: false,
  title: 'Read the docs',
  chats: [
    {
      handle: 'api',
      title: 'Read api docs',
      project: 'shop',
      agentMode: null,
      dependsOn: null,
      stacked: false,
      existing: false,
      task: 'Summarise api.md.',
    },
    {
      handle: 'web',
      title: 'Read web docs',
      project: 'shop',
      agentMode: 'auto',
      dependsOn: 'api',
      stacked: true,
      existing: false,
      task: 'Summarise web.md.',
    },
    {
      handle: 'docs',
      title: 'Check the docs chat',
      project: 'shop',
      agentMode: null,
      dependsOn: 'web',
      stacked: false,
      existing: true,
      task: 'Check the docs match.',
    },
  ],
};

const approval: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'spark:start_outpost:1',
  kind: 'spark_action',
  title: 'Start these sub-chats? Docs split',
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
  createdAt: '2026-10-20T10:00:00.000Z',
};

function seam(canManage: boolean): OutpostSeam {
  return {
    outposts: [],
    openOutpostId: null,
    canManage,
    onOpenOutpost: vi.fn(),
    onNewOutpost: vi.fn(),
    onOpenDraft: vi.fn(),
    onAddToOutpost: vi.fn(),
  };
}

function show(value: OutpostSeam) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OutpostSeamContext value={value}>
        <ApprovalCard approval={approval} provider="claude" agent="Bolt" repo={null} />
      </OutpostSeamContext>
    </QueryClientProvider>,
  );
}

describe('the card for starting sub-chats', () => {
  it('lists each chat with its place and mode, and offers Start and Discard', () => {
    show(seam(true));
    expect(screen.getByText('Start these sub-chats?')).toBeTruthy();
    expect(screen.getByText(/Bolt wants to start 3 sub-chats/)).toBeTruthy();
    expect(screen.getByText('@api')).toBeTruthy();
    expect(screen.getByText(/Stacked on @api · Mode: auto/)).toBeTruthy();
    expect(
      screen.getByText(/Existing chat · gets a request · shop · Starts after @web/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('opens the draft to edit on the Mac', () => {
    const value = seam(true);
    show(value);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(value.onOpenDraft).toHaveBeenCalledWith(DRAFT_ID);
  });

  it('offers no Edit where the draft cannot be edited', () => {
    show(seam(false));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});
