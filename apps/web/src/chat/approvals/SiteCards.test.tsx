// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, SparkAction } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function card(action: SparkAction, payload: Partial<Approval['payload']> = {}): Approval {
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    toolCallId: `spark:${action.action}:1`,
    kind: 'spark_action',
    title: 'A site card',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
      ...payload,
    },
    payloadHash: 'sha256:abc',
    options: [
      {
        optionId: 'confirm',
        name: payload.secretSend ? 'Allow once' : 'Allow for this chat',
        kind: 'allow_once',
      },
      { optionId: 'decline', name: 'Don’t', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-12T10:00:00.000Z',
  };
}

function show(approval: Approval) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={approval} provider="claude" agent="Bolt" repo={null} />
    </QueryClientProvider>,
  );
}

const open: SparkAction = {
  action: 'open_page',
  origin: 'https://docs.example.com',
  path: '/guide/start',
};
const act: SparkAction = {
  action: 'act_page',
  origin: 'https://docs.example.com',
  path: '/guide/start',
  title: 'Getting started',
  did: 'Typed in searchbox "Search the docs"',
  userTab: false,
};

describe('cards for a site outside this computer', () => {
  it('asks before the agent opens a site and says the allowance covers the chat', () => {
    show(card(open));
    const group = screen.getByRole('group', { name: /Let the agent open this site\?/ });
    expect(group.textContent).toContain('Bolt wants to open a site outside this computer');
    expect(group.textContent).toContain('https://docs.example.com/guide/start');
    expect(group.textContent).toContain('untrusted');
    expect(within(group).getByRole('button', { name: 'Allow for this chat' })).toBeTruthy();
  });

  it('shows the first step and whose tab it is before the agent acts', () => {
    show(card(act));
    const group = screen.getByRole('group', { name: /click and type on this site\?/ });
    expect(group.textContent).toContain('Typed in searchbox "Search the docs"');
    expect(group.textContent).toContain('The agent’s');
    expect(group.textContent).toContain('What the agent types goes to that site');
  });

  it('warns that the agent acts as the user on a tab the user opened', () => {
    show(card({ ...act, userTab: true }));
    const group = screen.getByRole('group', { name: /click and type on this site\?/ });
    expect(group.textContent).toContain('on a tab you opened');
    expect(group.textContent).toContain('Yours: you opened it');
    expect(group.textContent).toContain('the agent acts as you');
  });

  it('carries the note about what the turn read', () => {
    show(card(open, { observed: ['.env'] }));
    expect(screen.getByText(/Read sensitive data this turn:/).parentElement!.textContent).toContain(
      '.env',
    );
  });

  it('needs a hold to send a secret value, names the file and offers no plain allow', async () => {
    vi.useFakeTimers();
    const decide = vi.spyOn(approvalsApi, 'decide').mockResolvedValue(card(act));
    show(card(act, { secretSend: ['.env'] }));
    const group = screen.getByRole('group', { name: /Send a secret value\?/ });
    expect(group.textContent).toContain('holds a value from .env into this site');
    expect(group.textContent).toContain('one time only');
    expect(within(group).queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Allow for this chat' })).toBeNull();
    const hold = within(group).getByRole('button', { name: /Hold to allow once/ });
    fireEvent.keyDown(hold, { key: ' ' });
    vi.advanceTimersByTime(500);
    fireEvent.keyUp(hold, { key: ' ' });
    expect(decide).not.toHaveBeenCalled();
    fireEvent.keyDown(hold, { key: ' ' });
    await vi.advanceTimersByTimeAsync(1600);
    expect(decide).toHaveBeenCalledWith(
      '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
      expect.objectContaining({ optionId: 'confirm', scope: 'once' }),
    );
  });
});
