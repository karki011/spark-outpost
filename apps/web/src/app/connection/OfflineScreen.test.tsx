// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client.ts';
import { phoneApi } from '../../phone/phone-api.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { OfflineScreen } from './OfflineScreen.tsx';
import { ReconnectBanner } from './ReconnectBanner.tsx';
import { rememberRemoteClient, rememberedRemoteClient } from './remote-hint.ts';

const PAIRED_TITLE = "Can't reach your Mac";
const MAC_TITLE = 'Taking a quick nap';
const MAC_BODY = "The Spark Outpost server isn't answering. It may be restarting.";
const SERVER_TITLE = 'Feeling a little dizzy';
const WAKE_HELP = 'Wake the Mac, or check that Tailscale is connected on this device.';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers();
  localStorage.clear();
  rememberRemoteClient(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountScreen(error: unknown) {
  render(
    <OfflineScreen
      error={error}
      failedAt={Date.now()}
      onRetry={() => Promise.reject(error)}
      onBack={() => undefined}
    />,
  );
}

async function waitForFailedAttempts(count: number) {
  const seconds = [1, 2, 4, 8, 10];
  const ticks = seconds.slice(0, count).reduce((sum, wait) => sum + wait, 0);
  for (let tick = 0; tick < ticks; tick += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

const unreachable = () => new ApiError(0, 'unreachable', '/api/setup');

describe('OfflineScreen on the Mac', () => {
  it('keeps the restarting copy and the restart hint when unreachable', () => {
    mountScreen(unreachable());
    expect(screen.getByRole('heading', { name: MAC_TITLE })).toBeTruthy();
    expect(screen.getByText(MAC_BODY)).toBeTruthy();
    expect(screen.getByText(/restart it with/)).toBeTruthy();
  });

  it('never shows the wake line, however long it stays unreachable', async () => {
    mountScreen(unreachable());
    await waitForFailedAttempts(5);
    expect(screen.queryByText(WAKE_HELP)).toBeNull();
  });
});

describe('OfflineScreen on a paired device', () => {
  beforeEach(() => rememberRemoteClient(true));

  it('says the Mac cannot be reached and why', () => {
    mountScreen(unreachable());
    expect(screen.getByRole('heading', { name: PAIRED_TITLE })).toBeTruthy();
    expect(screen.getByText(/It may be asleep, shut down or off Tailscale/)).toBeTruthy();
    expect(screen.queryByText(MAC_BODY)).toBeNull();
    expect(screen.queryByText(/restart it with/)).toBeNull();
  });

  it('adds what to do only after several failed attempts, in a live region', async () => {
    mountScreen(unreachable());
    await waitForFailedAttempts(3);
    expect(screen.getByText(/Tried 3 times/)).toBeTruthy();
    expect(screen.queryByText(WAKE_HELP)).toBeNull();
    await waitForFailedAttempts(4);
    const help = screen.getByText(WAKE_HELP);
    expect(help.getAttribute('role')).toBe('status');
    expect(screen.getByText(/Tried 4 times/)).toBeTruthy();
  });

  it('keeps the server copy unchanged', async () => {
    mountScreen(new ApiError(500, 'boom', '/api/setup'));
    expect(screen.getByRole('heading', { name: SERVER_TITLE })).toBeTruthy();
    expect(screen.getByText('Something went wrong on the server.')).toBeTruthy();
    expect(screen.getByText(/restart it with/)).toBeTruthy();
    await waitForFailedAttempts(5);
    expect(screen.queryByText(WAKE_HELP)).toBeNull();
  });
});

describe('the remote fact', () => {
  it('survives a reload through local storage', () => {
    rememberRemoteClient(true);
    expect(localStorage.getItem('spark-outpost.remote-client')).toBe('1');
    expect(rememberedRemoteClient()).toBe(true);
  });

  it('is kept when the session query then fails', async () => {
    vi.useRealTimers();
    const session = { remote: true, switches: {} } as never;
    const spy = vi.spyOn(phoneApi, 'session').mockResolvedValueOnce(session);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Probe() {
      useRemoteClient();
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(rememberedRemoteClient()).toBe(true));
    spy.mockRejectedValue(unreachable());
    await client.refetchQueries();
    expect(rememberedRemoteClient()).toBe(true);
    vi.useFakeTimers();
    mountScreen(unreachable());
    expect(screen.getByRole('heading', { name: PAIRED_TITLE })).toBeTruthy();
  });
});

describe('ReconnectBanner', () => {
  function mountBanner() {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ReconnectBanner />
      </QueryClientProvider>,
    );
  }

  it('keeps its text on the Mac', () => {
    mountBanner();
    expect(screen.getByText('Lost the connection to the server. Reconnecting.')).toBeTruthy();
    expect(screen.getByText('Your chat stays open.')).toBeTruthy();
  });

  it('names the Mac on a paired device', () => {
    rememberRemoteClient(true);
    mountBanner();
    expect(screen.getByText("Can't reach your Mac. Reconnecting.").getAttribute('role')).toBe(
      'status',
    );
    expect(screen.getByText(/It may be asleep or off Tailscale/)).toBeTruthy();
  });
});
