// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareReach, RemoteAccess } from '@spark-outpost/contracts';
import { phoneApi } from '../phone/phone-api.ts';
import { CloudflareReachSetup } from './CloudflareReachSetup.tsx';
import { cloudflareApi } from './cloudflare-api.ts';

const step = (
  id: CloudflareReach['steps'][number]['id'],
  state: CloudflareReach['steps'][number]['state'],
  more: Partial<CloudflareReach['steps'][number]> = {},
) => ({ id, state, problem: null, fix: null, fixUrl: null, ...more });

const IDLE: CloudflareReach = {
  available: true,
  status: 'idle',
  authorizeUrl: null,
  account: null,
  signedIn: false,
  hostname: null,
  tunnel: 'off',
  permissions: (['account', 'domains', 'dns', 'tunnel', 'access'] as const).map((id) => ({
    id,
    state: 'needed',
  })),
  steps: (['signIn', 'domain', 'tunnel', 'address', 'signInPage', 'start'] as const).map((id) =>
    step(id, 'todo'),
  ),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(reach: CloudflareReach) {
  vi.spyOn(cloudflareApi, 'reach').mockResolvedValue(reach);
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CloudflareReachSetup onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}

describe('setting up a Cloudflare address for this computer', () => {
  it('shows nothing when this build can’t do it', async () => {
    const load = vi.spyOn(cloudflareApi, 'reach');
    show({ ...IDLE, available: false });
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Set it up with Cloudflare' })).toBeNull();
  });

  it('lists the five permissions and starts with a valid address and email', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const start = vi.spyOn(cloudflareApi, 'startReach').mockResolvedValue({
      ...IDLE,
      status: 'waiting',
      hostname: 'spark.example.com',
      authorizeUrl: 'https://dash.cloudflare.com/oauth2/auth?x',
    });
    show(IDLE);

    const asks = await screen.findByRole('list', { name: 'What Spark asks Cloudflare for' });
    expect(within(asks).getAllByRole('listitem')).toHaveLength(5);
    expect(asks.textContent).toContain('changes no other');

    fireEvent.click(screen.getByRole('button', { name: /^Allow on Cloudflare/ }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText('Type the domain your reverse proxy or tunnel serves.')).toBeTruthy();
    expect(screen.getByText('Type your email address.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'https://Spark.Example.com' },
    });
    fireEvent.change(screen.getByLabelText('Your email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Allow on Cloudflare/ }));
    await waitFor(() =>
      expect(start.mock.calls[0]?.[0]).toEqual({
        hostname: 'spark.example.com',
        email: 'owner@example.com',
      }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Waiting for you to allow Spark in Cloudflare.',
    );
  });

  it('turns Remote control on at the address once every step is done', async () => {
    const access = { hostname: 'spark.example.com', reach: 'custom' } as RemoteAccess;
    const setAccess = vi.spyOn(phoneApi, 'setAccess').mockResolvedValue(access);
    const onSaved = show({
      ...IDLE,
      status: 'done',
      hostname: 'spark.example.com',
      tunnel: 'running',
      steps: IDLE.steps.map((one) => step(one.id, 'done')),
    });
    await waitFor(() =>
      expect(setAccess).toHaveBeenCalledWith({ hostname: 'spark.example.com', confirmed: true }),
    );
    await waitFor(() => expect(onSaved.mock.calls[0]?.[0]).toEqual(access));
    expect(setAccess).toHaveBeenCalledTimes(1);
  });

  it('offers the fix for a step that needs the user', async () => {
    const resume = vi.spyOn(cloudflareApi, 'resumeReach').mockResolvedValue(IDLE);
    show({
      ...IDLE,
      status: 'stopped',
      hostname: 'spark.example.com',
      steps: IDLE.steps.map((one) =>
        one.id === 'signInPage'
          ? step('signInPage', 'failed', {
              problem: 'Cloudflare couldn’t add the sign-in page.',
              fix: 'cloudflare',
              fixUrl: 'https://one.dash.cloudflare.com/',
            })
          : step(one.id, one.id === 'start' ? 'todo' : 'done'),
      ),
    });
    const steps = await screen.findByRole('list', { name: 'Set-up steps' });
    const stuck = within(steps).getByRole('alert').closest('li')!;
    expect(within(stuck).getByRole('link', { name: /^Open Cloudflare/ })).toHaveProperty(
      'href',
      'https://one.dash.cloudflare.com/',
    );
    fireEvent.click(within(stuck).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });
});
