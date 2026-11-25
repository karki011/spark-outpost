// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupDrafts } from '@spark-outpost/contracts';
import { setupDraftsApi } from '../setup-drafts/setup-drafts-api.ts';
import { TicketConnectForm } from './TicketConnectForm.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(drafts: SetupDrafts['drafts'], source: 'jira' | 'servicenow' = 'jira') {
  vi.spyOn(setupDraftsApi, 'list').mockResolvedValue({ drafts });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TicketConnectForm source={source} onCancel={() => undefined} />
    </QueryClientProvider>,
  );
}

const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;

describe('a connection an agent prepared', () => {
  it('prefills the site and email and leaves the token for the user', async () => {
    show([
      {
        target: 'atlassian',
        fields: { siteUrl: 'acme.atlassian.net', email: 'me@acme.test' },
        conversationId: null,
        createdAt: '2026-11-24T10:00:00.000Z',
      },
    ]);
    await waitFor(() => expect(field(/email/i).value).toBe('me@acme.test'));
    expect(field(/site/i).value).toBe('acme.atlassian.net');
    expect(field(/token/i).value).toBe('');
  });

  it('ignores a setup prepared for another connector', async () => {
    show([
      {
        target: 'servicenow',
        fields: { instanceUrl: 'https://acme.service-now.com', username: 'svc' },
        conversationId: null,
        createdAt: '2026-11-24T10:00:00.000Z',
      },
    ]);
    await waitFor(() => expect(setupDraftsApi.list).toHaveBeenCalled());
    expect(field(/email/i).value).toBe('');
  });
});
