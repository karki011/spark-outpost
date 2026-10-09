// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_SWITCH_DEFAULTS } from '@spark-outpost/contracts';
import { PasskeyOffer } from './PasskeyOffer.tsx';

const SETTLE = { timeout: 3000 };
const SAVE = 'Save a passkey for this phone';
const DEVICE = { id: '11111111-1111-4111-8111-111111111111', name: 'Pixel' };

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface Scene {
  remote?: boolean;
  passkeys?: boolean;
  saved?: number;
  otherNotice?: boolean;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serve(scene: Scene) {
  const remote = scene.remote ?? true;
  const saved = Array.from({ length: scene.saved ?? 0 }, (_unused, index) => ({
    id: `22222222-2222-4222-8222-22222222222${index}`,
    label: null,
    synced: false,
    createdAt: '2026-10-06T10:00:00Z',
    lastUsedAt: null,
  }));
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      if (path.endsWith('/remote/session')) {
        return json({
          remote,
          device: remote ? DEVICE : null,
          address: 'https://mac.tail1234.ts.net',
          switches: { ...REMOTE_SWITCH_DEFAULTS, passkeys: scene.passkeys ?? true },
        });
      }
      if (path.endsWith('/remote/passkeys')) return json({ passkeys: saved });
      return json({
        profile: {
          displayName: 'Ada',
          defaultProvider: null,
          onboardingCompleted: true,
          defaultLevelNotice: scene.otherNotice ?? false,
        },
        providers: [],
        advisors: [],
      });
    }),
  );
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PasskeyOffer />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
  return client;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('PublicKeyCredential', class {});
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create: vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError'))) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
});

describe('the passkey offer on a paired phone', () => {
  it('offers once and explains what a passkey is for', async () => {
    serve({});
    await show();
    expect(await screen.findByRole('button', { name: SAVE }, SETTLE)).toBeTruthy();
    expect(
      screen.getByText(/Lets this phone sign in again in another browser without going back/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    cleanup();
    await show();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('stays away on the Mac, with the switch off, and once a passkey is saved', async () => {
    for (const scene of [{ remote: false }, { passkeys: false }, { saved: 1 }]) {
      serve(scene);
      await show();
      expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
      cleanup();
    }
  });

  it('stays away in a browser without passkeys, and while another notice is showing', async () => {
    serve({ otherNotice: true });
    await show();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    cleanup();
    vi.stubGlobal('PublicKeyCredential', undefined);
    serve({});
    await show();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('keeps the offer and says so when the system prompt is cancelled', async () => {
    serve({});
    await show();
    const fetchPlain = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/remote/passkeys/options')) {
        return json({
          rp: { id: 'mac.tail1234.ts.net', name: 'Spark Outpost' },
          user: { id: 'AAAA', name: 'Pixel', displayName: 'Pixel' },
          challenge: 'AAAA',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          timeout: 120000,
          attestation: 'none',
          excludeCredentials: [],
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required',
          },
        });
      }
      return fetchPlain(url, init);
    });
    fireEvent.click(await screen.findByRole('button', { name: SAVE }, SETTLE));
    expect((await screen.findByRole('alert', undefined, SETTLE)).textContent).toContain(
      'No passkey was saved. Try again when you are ready.',
    );
    expect(screen.getByRole('button', { name: SAVE })).toBeTruthy();
  });
});
