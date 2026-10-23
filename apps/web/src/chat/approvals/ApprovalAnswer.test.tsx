// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { StatusContext } from '../status/status-context.ts';
import { createStatusStore } from '../status/status-store.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { approval, buttonNames } from './test-approval.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const claude: Approval = {
  ...approval,
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
  ],
};

function spyDecide() {
  return vi
    .spyOn(approvalsApi, 'decide')
    .mockImplementation(() => new Promise<Approval>(() => undefined));
}

function show(shown: Approval) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={shown} provider="claude" agent="Claude" repo={null} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name: /\?$/ });
}

async function chosen(decide: ReturnType<typeof spyDecide>) {
  await act(async () => undefined);
  return decide.mock.calls.map(([, decision]) => [decision.optionId, decision.scope]);
}

describe('Always allow', () => {
  it('opens a menu built from the request’s own always options', async () => {
    const decide = spyDecide();
    const card = show(claude);
    expect(buttonNames(card)).toEqual(['Allow', 'Always allow', 'Deny', 'Details']);
    const always = within(card).getByRole('button', { name: 'Always allow' });
    expect(always.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(always);
    const menu = screen.getByRole('menu', { name: 'Always allow' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Always allow', 'Always allow in this project']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Always allow in this project' }));
    expect(await chosen(decide)).toEqual([['allow', 'project']]);
  });

  it('keeps Codex’s own names and its second reject', async () => {
    const decide = spyDecide();
    const card = show({
      ...approval,
      options: [
        { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
        { optionId: 'yes-always', name: "Yes, and don't ask again", kind: 'allow_always' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
        { optionId: 'no-always', name: "No, and don't ask again", kind: 'reject_always' },
      ],
    });
    expect(buttonNames(card)).toEqual([
      'Yes',
      'Always allow',
      'No',
      "No, and don't ask again",
      'Details',
    ]);
    fireEvent.click(within(card).getByRole('button', { name: 'Always allow' }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Yes, and don't ask again" }));
    expect(await chosen(decide)).toEqual([['yes-always', 'once']]);
  });

  it('is a plain button when there is one choice and absent when there is none', async () => {
    const decide = spyDecide();
    const edit: Approval = {
      ...claude,
      kind: 'edit',
      payload: { ...claude.payload, command: null, paths: [] },
    };
    const card = show(edit);
    expect(buttonNames(card)).toEqual(['Allow', 'Always allow', 'Deny', 'Details']);
    expect(
      within(card).getByRole('button', { name: 'Always allow' }).getAttribute('aria-haspopup'),
    ).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Always allow' }));
    expect(await chosen(decide)).toEqual([['allow-always', 'once']]);
    cleanup();
    const plain = show({ ...edit, options: approval.options });
    expect(buttonNames(plain)).toEqual(['Yes', 'No', 'Details']);
  });
});

describe('keys on a waiting card', () => {
  it('answers Allow with Enter only while the card itself has focus', async () => {
    const decide = spyDecide();
    const card = show(claude);
    fireEvent.keyDown(within(card).getByRole('button', { name: 'Deny' }), { key: 'Enter' });
    expect(await chosen(decide)).toEqual([]);
    const title = card.querySelector<HTMLElement>('.appr-h')!;
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(await chosen(decide)).toEqual([['allow', 'once']]);
  });

  it('answers Deny with Esc and keeps the key from reaching the turn’s Stop', async () => {
    const decide = spyDecide();
    const stop = vi.fn();
    window.addEventListener('keydown', stop);
    const card = show(claude);
    const reached = fireEvent.keyDown(within(card).getByRole('button', { name: 'Allow' }), {
      key: 'Escape',
    });
    window.removeEventListener('keydown', stop);
    expect(reached).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(await chosen(decide)).toEqual([['reject', 'once']]);
  });

  it('closes the Always allow menu on Esc without denying', async () => {
    const decide = spyDecide();
    const card = show(claude);
    fireEvent.click(within(card).getByRole('button', { name: 'Always allow' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Always allow' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await chosen(decide)).toEqual([]);
  });

  it('never answers a hold-to-confirm card with Enter', async () => {
    const decide = spyDecide();
    const card = show({
      ...claude,
      payload: { ...claude.payload, command: 'git push -f', forcePush: ['main'] },
      reason: 'This rewrites history',
    });
    const title = card.querySelector<HTMLElement>('.appr-h')!;
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(await chosen(decide)).toEqual([]);
  });

  it('takes focus when it arrives and nothing else has it, never from the composer', async () => {
    const first = show(claude);
    expect(document.activeElement).toBe(first.querySelector('.appr-h'));
    cleanup();
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.focus();
    show(claude);
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });
});

describe('waiting count', () => {
  it('says which of several waiting cards this is', async () => {
    const store = createStatusStore();
    render(
      <StatusContext value={store}>
        <QueryClientProvider client={new QueryClient()}>
          <ApprovalCard approval={claude} provider="claude" agent="Claude" repo={null} />
          <ApprovalCard
            approval={{
              ...claude,
              id: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
              createdAt: '2026-09-26T10:01:00.000Z',
            }}
            provider="claude"
            agent="Claude"
            repo={null}
          />
        </QueryClientProvider>
      </StatusContext>,
    );
    act(() => undefined);
    expect(screen.getByText('1 of 2 waiting')).toBeTruthy();
    expect(screen.getByText('2 of 2 waiting')).toBeTruthy();
  });
});
