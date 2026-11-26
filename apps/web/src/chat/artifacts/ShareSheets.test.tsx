// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactShareService } from '@spark-outpost/contracts';
import { HOSTED_LIMIT_LINE, ShareConfirmSheet, ShareConnectSheet } from './ShareSheets.tsx';

afterEach(cleanup);

function confirm(service: ArtifactShareService, days: number[], host: string | null = null) {
  const onCreate = vi.fn();
  const onConnect = vi.fn();
  render(
    <ShareConfirmSheet
      title="Deploy failures"
      version={2}
      bytes={2048}
      service={service}
      host={host}
      days={days}
      busy={false}
      failure={null}
      onCancel={() => undefined}
      onConnect={onConnect}
      onCreate={onCreate}
    />,
  );
  return { onCreate, onConnect };
}

describe('the share sheet', () => {
  it('names the user’s own Cloudflare account and offers its expiry choices', () => {
    const { onCreate } = confirm('own', [1, 7], 'spark-share.acme.workers.dev');
    const sheet = screen.getByRole('dialog', { name: 'Share “Deploy failures”?' });
    expect(sheet.textContent).toContain('Shared from');
    expect(sheet.textContent).toContain('Your Cloudflare account');
    expect(sheet.textContent).toContain('spark-share.acme.workers.dev');
    expect(sheet.textContent).not.toContain(HOSTED_LIMIT_LINE);
    const picker = screen.getByRole('button', { name: 'Link ends after' });
    expect(picker.textContent).toBe('7 days');
    fireEvent.click(picker);
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      '1 day',
      '7 days',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1 day' }));
    expect(picker.textContent).toBe('1 day');
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(onCreate).toHaveBeenCalledWith({ expiresInDays: 1, passcode: false });
  });

  it('shows a single expiry as text and points from the shared service to Cloudflare', () => {
    const { onCreate, onConnect } = confirm('hosted', [1]);
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Spark’s shared service');
    expect(sheet.textContent).not.toContain('Your Cloudflare account');
    expect(sheet.textContent).toContain('Expires in 1 day');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(sheet.textContent).toContain(
      'Links from Spark’s shared service last 1 day. Connect your own Cloudflare account for 7 days.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cloudflare' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(onCreate).toHaveBeenCalledWith({ expiresInDays: 1, passcode: false });
  });

  it('asks to connect Cloudflare when nothing can share', () => {
    const onConnect = vi.fn();
    render(<ShareConnectSheet onCancel={() => undefined} onConnect={onConnect} />);
    const sheet = screen.getByRole('dialog', { name: 'Connect Cloudflare to share artifacts' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Cloudflare' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(sheet.textContent).toContain('Settings → Connectors');
  });
});
