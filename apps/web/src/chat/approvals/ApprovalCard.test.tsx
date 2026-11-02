// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { approval, buttonNames } from './test-approval.ts';

afterEach(cleanup);

function show(shown: Approval, name: RegExp = /^Run pnpm test\?$/) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={shown} provider="claude" agent="Bolt" repo={null} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name });
}

describe('ApprovalCard', () => {
  it('asks the question in its title and shows the command once', () => {
    const card = show(approval);
    expect(within(card).getByText('pnpm test', { selector: 'code' })).toBeTruthy();
    expect(within(card).getByText('pnpm test', { selector: 'pre' })).toBeTruthy();
    expect(card.textContent).not.toContain('wants to run');
    expect(buttonNames(card)).toEqual(['Yes', 'Always allow in this project', 'No', 'Details']);
    expect(within(card).queryByRole('status')).toBeNull();
  });

  it('keeps the folder and the allowlist note folded under Details', () => {
    const card = show(approval);
    const details = within(card).getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(card.textContent).not.toContain('Runs in');
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(card.textContent).toContain("Runs in /work. It isn't on the project's allowlist yet.");
  });

  it('puts the agent’s own reason under Details', () => {
    const card = show({
      ...approval,
      payload: { ...approval.payload, agentReason: 'to check the build' },
    });
    expect(card.textContent).not.toContain('asks because');
    fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(card.textContent).toContain('Bolt asks because: to check the build');
  });

  it('names the sub-agent that asked', () => {
    const card = show({ ...approval, payload: { ...approval.payload, subagent: 'Explore' } });
    expect(card.textContent).toContain("Asked by Bolt's sub-agent Explore.");
  });

  it('asks to hold before a force push and offers no plain or project allow', () => {
    const push = 'git push --force-with-lease origin feature';
    const card = show(
      {
        ...approval,
        title: push,
        payload: { ...approval.payload, command: push, forcePush: ['feature'] },
        reason: 'This rewrites history on feature on the remote',
      },
      /^Force push\?$/,
    );
    expect(buttonNames(card)).toEqual(['Hold to force push', 'No', 'Details']);
    expect(card.textContent).toContain(
      'This rewrites history on feature on the remote, whatever your permissions.',
    );
    expect(card.textContent).toContain('wants to rewrite history on the remote.');
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
      /^Send a secret value\?$/,
    );
    expect(card.textContent).toContain('wants to send something that holds a value from .env.');
    expect(card.textContent).toContain(
      'This sends a value from .env off this computer, whatever your permissions.',
    );
    expect(buttonNames(card)).toEqual(['Hold to allow once', 'No', 'Details']);
  });

  it('titles an edit by its file and shows the change count beside the title', () => {
    const card = show(
      {
        ...approval,
        kind: 'edit',
        title: 'Edit notes.txt',
        payload: {
          ...approval.payload,
          command: null,
          paths: ['src/notes.txt'],
          diffs: [{ path: 'src/notes.txt', oldText: 'a\nb\n', newText: 'a\nc\nd\n' }],
        },
      },
      /^Edit notes\.txt\?$/,
    );
    expect(card.querySelector('.appr-h .appr-count')?.textContent).toBe('+2 −1');
    expect(card.querySelector('figure .appr-count')).toBeNull();
    expect(within(card).getByRole('region', { name: 'Changes to src/notes.txt' })).toBeTruthy();
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
      /^Allow this action\?$/,
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
