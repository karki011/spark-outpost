// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareReach } from '@spark-outpost/contracts';
import { cloudflareApi } from './cloudflare-api.ts';
import { CloudflareTunnelLine, TUNNEL_KEPT } from './CloudflareTunnelLine.tsx';

const REACH: CloudflareReach = {
  available: true,
  status: 'idle',
  authorizeUrl: null,
  account: null,
  signedIn: false,
  hostname: null,
  connected: 'spark.example.com',
  tunnel: 'running',
  permissions: [],
  steps: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(reach: CloudflareReach, hostname = 'spark.example.com') {
  const load = vi.spyOn(cloudflareApi, 'reach').mockResolvedValue(reach);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CloudflareTunnelLine hostname={hostname} />
    </QueryClientProvider>,
  );
  return load;
}

describe('the Cloudflare Tunnel line in Remote control', () => {
  it('says the tunnel is connected and what Turn off leaves in Cloudflare', async () => {
    show(REACH);
    expect((await screen.findByRole('status')).textContent).toBe('Cloudflare Tunnel: Connected');
    expect(screen.getByText(TUNNEL_KEPT)).toBeTruthy();
  });

  it('says when the tunnel is not connected', async () => {
    show({ ...REACH, tunnel: 'stopped' });
    expect((await screen.findByRole('status')).textContent).toBe(
      'Cloudflare Tunnel: Not connected. Spark keeps trying.',
    );
  });

  it('shows nothing for a custom domain Spark did not set up', async () => {
    const load = show(REACH, 'other.example.com');
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
