// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullDiskAccess } from './FullDiskAccess.tsx';

const SETTLE = { timeout: 3000 };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { sparkDesktop?: unknown }).sparkDesktop;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function server(statuses: string[]) {
  const queue = [...statuses];
  const last = statuses[statuses.length - 1];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ status: queue.shift() ?? last })),
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FullDiskAccess />
    </QueryClientProvider>,
  );
  return client;
}

describe('Full Disk Access setting', () => {
  it('hides entirely when the server reports it is unsupported', async () => {
    server(['unsupported']);
    const client = show();
    await waitFor(
      () => expect(client.getQueryState(['full-disk-access'])?.status).toBe('success'),
      SETTLE,
    );
    expect(screen.queryByRole('region', { name: 'Full Disk Access' })).toBeNull();
  });

  it('shows a granted pill once the server confirms access', async () => {
    server(['granted']);
    show();
    await screen.findByText('Granted', undefined, SETTLE);
    expect(screen.getByRole('region', { name: 'Full Disk Access' }).textContent).toContain(
      "Spark's own approvals",
    );
  });

  it('shows a pending pill and explains the system settings steps in a browser', async () => {
    server(['not_granted']);
    show();
    await screen.findByText('Not yet', undefined, SETTLE);
    expect(screen.getByRole('link', { name: /Privacy & Security/ }).getAttribute('href')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    );
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull();
  });

  it('opens system settings through the desktop bridge and re-checks', async () => {
    server(['not_granted', 'granted']);
    const openFullDiskAccess = vi.fn().mockResolvedValue(undefined);
    (window as { sparkDesktop?: unknown }).sparkDesktop = {
      platform: 'darwin',
      privacy: { openFullDiskAccess },
    };
    show();
    const button = await screen.findByRole('button', { name: 'Open System Settings' }, SETTLE);
    fireEvent.click(button);
    expect(openFullDiskAccess).toHaveBeenCalledTimes(1);
    await screen.findByText('Granted', undefined, SETTLE);
  });
});
