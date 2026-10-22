// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { ApprovalCard } from './ApprovalCard.tsx';

afterEach(cleanup);

const approval: Approval = {
  id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'pnpm test',
  payload: { command: 'pnpm test', cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
  ],
  status: 'pending',
  reason: null,
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-26T10:00:00.000Z',
};

function show(shown: Approval, name = /Run a command\?/) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={shown} provider="claude" agent="Bolt" repo={null} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name });
}

describe('ApprovalCard', () => {
  it('offers the options while the approval waits', () => {
    const card = show(approval);
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Yes', 'Always allow in this project', 'No']);
    expect(within(card).queryByRole('status')).toBeNull();
  });

  it('asks to hold before a force push and offers no plain or project allow', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApprovalCard
          approval={{
            ...approval,
            title: 'git push --force-with-lease origin feature',
            payload: {
              ...approval.payload,
              command: 'git push --force-with-lease origin feature',
              forcePush: ['feature'],
            },
            reason: 'This rewrites history on feature on the remote',
          }}
          provider="claude"
          agent="Bolt"
          repo={null}
        />
      </QueryClientProvider>,
    );
    const card = screen.getByRole('group', { name: /Force push\?/ });
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Hold to force push', 'No']);
    expect(card.textContent).toContain(
      'This rewrites history on feature on the remote, whatever your permissions.',
    );
  });

  it('asks to hold before a send that holds a secret value, naming only the file', () => {
    const push = 'git push origin spark/fix';
    const card = show(
      {
        ...approval,
        title: push,
        payload: { ...approval.payload, command: push, secretSend: ['.env'] },
        reason: 'This sends a value from .env off this computer',
      },
      /Send a secret value\?/,
    );
    expect(card.textContent).toContain('wants to send something that holds a value from .env.');
    expect(card.textContent).toContain(
      'This sends a value from .env off this computer, whatever your permissions.',
    );
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Hold to allow once', 'No']);
  });

  it("shows a web fetch's full address while it waits, not the work log's past tense", () => {
    const address = 'https://docs.example.com/guide?page=2';
    const card = show(
      {
        ...approval,
        kind: 'other',
        title: `Fetch ${address}`,
        payload: { ...approval.payload, command: null, cwd: null },
      },
      /Allow this action\?/,
    );
    expect(card.textContent).toContain(`Fetch ${address}`);
    expect(card.textContent).not.toContain('Fetched');
  });

  it('folds an answered approval into one resolved line with the command and the choice', () => {
    const card = show({
      ...approval,
      status: 'denied',
      decidedBy: 'user',
      decisionOptionId: 'no',
      scope: 'once',
      decidedAt: '2026-09-26T10:00:05.000Z',
    });
    expect(within(card).queryAllByRole('button')).toEqual([]);
    expect(within(card).getByText('pnpm test').tagName).toBe('CODE');
    expect(within(card).queryByText(/Runs in/)).toBeNull();
    expect(within(card).getByRole('status').textContent).toBe("Chose: No.The command didn't run.");
  });
});
