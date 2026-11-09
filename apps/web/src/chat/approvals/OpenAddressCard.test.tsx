// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { phoneKeys } from '../../phone/phone-api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { approval as base } from './test-approval.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const URL = 'https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A5555';

function card(extra: Partial<Approval['payload']> = {}): Approval {
  return {
    ...base,
    kind: 'other',
    title: 'Open this address?',
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      openAddress: { url: URL, host: 'auth.example.com', message: 'Sign in to docs' },
      ...extra,
    },
    options: [
      { optionId: 'open', name: 'Open', kind: 'allow_once' },
      { optionId: 'dont', name: 'Don’t', kind: 'reject_once' },
    ],
  };
}

function show(approval: Approval, remote = false) {
  const client = new QueryClient();
  client.setQueryData(phoneKeys.session, { remote, switches: {} });
  render(
    <QueryClientProvider client={client}>
      <ApprovalCard approval={approval} provider="codex" agent="Codex" repo={null} />
    </QueryClientProvider>,
  );
}

describe('the Open this address card', () => {
  it('shows the whole address with its host in bold and the message as untrusted', () => {
    show(card());
    const group = screen.getByRole('group', { name: 'Open this address?' });
    expect(group.textContent).toContain('Codex wants you to open an address in your browser.');
    expect(within(group).getByText('auth.example.com').tagName).toBe('B');
    expect(group.textContent).toContain(URL);
    expect(group.textContent).toContain('It says, as untrusted text: Sign in to docs');
  });

  it('opens the address in the default browser, then answers Open', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    show(card());
    fireEvent.click(screen.getByRole('button', { name: /^Open/ }));
    expect(opened).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(base.id, {
        optionId: 'open',
        scope: 'once',
        payloadHash: base.payloadHash,
      }),
    );
  });

  it('answers Don’t without opening anything', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    show(card());
    fireEvent.click(screen.getByRole('button', { name: /^Don’t/ }));
    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide.mock.calls[0]?.[1]).toMatchObject({ optionId: 'dont' });
    expect(opened).not.toHaveBeenCalled();
  });

  it('asks to hold when the address holds a secret value, with no plain Open', () => {
    show(card({ secretSend: ['.env'] }));
    const group = screen.getByRole('group', { name: 'Open this address?' });
    expect(group.textContent).toContain('holds a value from .env');
    expect(within(group).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(within(group).getByRole('button', { name: /Hold to open/ })).toBeTruthy();
  });

  it('waits for the Mac on a paired device, with nothing to press', () => {
    show(card(), true);
    const group = screen.getByRole('group', { name: 'Open this address?' });
    expect(group.textContent).toContain('Waiting for you on your Mac. Addresses open there.');
    expect(within(group).queryAllByRole('button')).toHaveLength(0);
  });
});
