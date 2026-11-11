// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullDiskAccessPrompt } from './FullDiskAccessPrompt.tsx';

const SETTLE = { timeout: 3000 };
const TITLE = 'Let agents read protected folders?';
const remoteState = { remote: false };

vi.mock('../phone/use-remote-client.ts', () => ({
  useRemoteClient: () => ({ remote: remoteState.remote, allows: () => true }),
}));

beforeEach(() => {
  localStorage.clear();
  remoteState.remote = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { sparkDesktop?: unknown }).sparkDesktop;
});

function server(statuses: string[]) {
  const queue = [...statuses];
  const last = statuses[statuses.length - 1];
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: queue.shift() ?? last }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installDesktop() {
  const openFullDiskAccess = vi.fn().mockResolvedValue(undefined);
  (window as { sparkDesktop?: unknown }).sparkDesktop = {
    platform: 'darwin',
    privacy: { openFullDiskAccess },
  };
  return openFullDiskAccess;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FullDiskAccessPrompt />
    </QueryClientProvider>,
  );
  return client;
}

async function settled(client: QueryClient) {
  await waitFor(
    () => expect(client.getQueryState(['full-disk-access'])?.status).toBe('success'),
    SETTLE,
  );
}

describe('Full Disk Access prompt', () => {
  it('shows the offer for not_granted in the desktop shell', async () => {
    server(['not_granted']);
    installDesktop();
    mount();
    expect(await screen.findByText(TITLE, undefined, SETTLE)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Optional; Spark works without it.');
  });

  it.each(['granted', 'unknown', 'unsupported'])('stays hidden for %s', async (status) => {
    server([status]);
    installDesktop();
    const client = mount();
    await settled(client);
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays hidden in a browser without the desktop bridge and asks nothing', async () => {
    const fetchMock = server(['not_granted']);
    mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays hidden on a paired device', async () => {
    const fetchMock = server(['not_granted']);
    installDesktop();
    remoteState.remote = true;
    mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens System Settings through the bridge, re-checks and disappears once granted', async () => {
    server(['not_granted', 'granted']);
    const openFullDiskAccess = installDesktop();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open System Settings' }, SETTLE));
    expect(openFullDiskAccess).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull(), SETTLE);
  });

  it('Not now hides it for this session only', async () => {
    server(['not_granted']);
    installDesktop();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }, SETTLE));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(localStorage.length).toBe(0);
    cleanup();
    mount();
    expect(await screen.findByText(TITLE, undefined, SETTLE)).toBeTruthy();
  });

  it("Don't ask again hides it and keeps it hidden on remount", async () => {
    server(['not_granted']);
    installDesktop();
    mount();
    fireEvent.click(await screen.findByRole('button', { name: "Don't ask again" }, SETTLE));
    expect(screen.queryByText(TITLE)).toBeNull();
    cleanup();
    const client = mount();
    await settled(client);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
