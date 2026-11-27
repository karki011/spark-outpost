// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_OUTSIDE_TARGET,
  CLOUDFLARE_DEPLOY_URL,
  CLOUDFLARE_PROBLEMS,
  guideLink,
  type CloudflareConnection,
  type CloudflareSetup,
  type RemoteSession,
} from '@spark-outpost/contracts';
import { phoneApi } from '../phone/phone-api.ts';
import { DocsReachable } from '../ui/DocLink.tsx';
import { CloudflareCard } from './CloudflareCard.tsx';
import { cloudflareApi } from './cloudflare-api.ts';

const UPLOAD_KEY = 'k'.repeat(40);

const NOT_CONNECTED: CloudflareConnection = {
  connected: false,
  origin: null,
  host: null,
  shareArtifacts: false,
  checkedAt: null,
  problem: null,
  sharedNow: 0,
  deployUrl: CLOUDFLARE_DEPLOY_URL,
};

const CONNECTED: CloudflareConnection = {
  ...NOT_CONNECTED,
  connected: true,
  origin: 'https://spark-share.acme.workers.dev',
  host: 'spark-share.acme.workers.dev',
  shareArtifacts: true,
  checkedAt: new Date().toISOString(),
  sharedNow: 3,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NO_SETUP: CloudflareSetup = {
  available: false,
  status: 'idle',
  authorizeUrl: null,
  account: null,
  permissions: [],
  steps: [],
};

function show(connection: CloudflareConnection, remote = false, setup = NO_SETUP) {
  vi.spyOn(phoneApi, 'session').mockResolvedValue({ remote } as RemoteSession);
  vi.spyOn(cloudflareApi, 'setup').mockResolvedValue(setup);
  const load = vi.spyOn(cloudflareApi, 'connection').mockResolvedValue(connection);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DocsReachable value>
        <ul>
          <CloudflareCard icon={null} open onToggle={() => undefined} />
        </ul>
      </DocsReachable>
    </QueryClientProvider>,
  );
  return { load, view };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe('Cloudflare, not connected', () => {
  it('walks through an account, the deploy and the connection', async () => {
    show(NOT_CONNECTED);
    await screen.findByText(
      'Share artifacts from your own Cloudflare account. Shared pages are stored there and served from your address.',
    );
    const needs = await screen.findByRole('region', { name: 'What you need' });
    expect(needs.textContent).toContain('A free Cloudflare account.');
    expect(needs.textContent).toContain(
      'A GitHub or GitLab account. Cloudflare’s Deploy button copies the share service into it.',
    );
    expect(needs.textContent).toContain(
      'About 10 minutes. Until then, Share… uses Spark’s shared service with 1-day links.',
    );
    expect(within(needs).getByRole('link', { name: 'Set-up guide' }).getAttribute('href')).toBe(
      guideLink('connect-cloudflare'),
    );
    const steps = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent);
    expect(steps).toEqual([
      'What you need',
      'Create a Cloudflare account',
      'Deploy the share service',
      'Connect it to Spark',
    ]);
    const account = screen.getByRole('link', { name: /^Create a free account/ });
    expect(account.getAttribute('href')).toBe('https://dash.cloudflare.com/sign-up');
    const deploy = screen.getByRole('link', { name: /^Deploy to Cloudflare/ });
    expect(deploy.getAttribute('href')).toBe(CLOUDFLARE_DEPLOY_URL);
    expect([BROWSER_OUTSIDE_TARGET, '_blank']).toContain(deploy.getAttribute('target'));
    screen.getByText(
      'Opens Cloudflare in your browser. It creates a Worker and a storage bucket in your account and asks you to set an upload key.',
    );
    screen.getByText('Kept in this computer’s keychain. Only Spark with this key can add pages.');
    expect(field('Upload key').type).toBe('password');
  });

  it('names a bad address and a bad key as they are typed', async () => {
    show(NOT_CONNECTED);
    await screen.findByLabelText('Service address');
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.change(field('Service address'), { target: { value: 'http://share.example/x' } });
    screen.getByText(CLOUDFLARE_PROBLEMS.address);
    expect(field('Service address').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field('Upload key'), { target: { value: 'short' } });
    screen.getByText(CLOUDFLARE_PROBLEMS.key);
    expect(connect.disabled).toBe(true);
    fireEvent.change(field('Service address'), {
      target: { value: 'https://spark-share.acme.workers.dev' },
    });
    fireEvent.change(field('Upload key'), { target: { value: UPLOAD_KEY } });
    expect(screen.queryByText(CLOUDFLARE_PROBLEMS.address)).toBeNull();
    expect(screen.queryByText(CLOUDFLARE_PROBLEMS.key)).toBeNull();
    expect(connect.disabled).toBe(false);
  });

  it('sends the address and key, then never shows the key again', async () => {
    const { view } = show(NOT_CONNECTED);
    const connect = vi.spyOn(cloudflareApi, 'connect').mockResolvedValue(CONNECTED);
    await screen.findByLabelText('Service address');
    fireEvent.change(field('Service address'), {
      target: { value: ' https://spark-share.acme.workers.dev ' },
    });
    fireEvent.change(field('Upload key'), { target: { value: UPLOAD_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByText('spark-share.acme.workers.dev', { selector: 'dd' });
    expect(connect.mock.calls[0]![0]).toEqual({
      address: 'https://spark-share.acme.workers.dev',
      uploadKey: UPLOAD_KEY,
    });
    expect(view.container.innerHTML).not.toContain(UPLOAD_KEY);
    expect(screen.queryByLabelText('Upload key')).toBeNull();
  });

  it('shows what the server said in one line', async () => {
    show(NOT_CONNECTED);
    vi.spyOn(cloudflareApi, 'connect').mockRejectedValue(new Error(CLOUDFLARE_PROBLEMS.refused));
    await screen.findByLabelText('Service address');
    fireEvent.change(field('Service address'), { target: { value: 'https://s.example.dev' } });
    fireEvent.change(field('Upload key'), { target: { value: UPLOAD_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe(CLOUDFLARE_PROBLEMS.refused);
  });
});

describe('Cloudflare, connected', () => {
  it('shows the status, the address, the count and the cost note', async () => {
    show(CONNECTED);
    const status = await screen.findByText('Connected', { selector: 'dd' });
    expect(status.querySelector('svg')).not.toBeNull();
    screen.getByText('spark-share.acme.workers.dev', { selector: 'dd' });
    expect(screen.getByText('Pages shared now').nextElementSibling?.textContent).toBe('3');
    expect(screen.getByText('Last checked').nextElementSibling?.textContent).toContain('just now');
    screen.getByText('Share… on an artifact uploads here.');
    screen.getByText(
      'Usage and any cost are on your Cloudflare account. Spark never sees your Cloudflare sign-in.',
    );
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('turns sharing off and on', async () => {
    show(CONNECTED);
    const update = vi
      .spyOn(cloudflareApi, 'update')
      .mockResolvedValue({ ...CONNECTED, shareArtifacts: false });
    const toggle = await screen.findByRole('switch', { name: 'Share artifacts from this account' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(update.mock.calls[0]![0]).toEqual({ shareArtifacts: false });
  });

  it('checks again and shows a problem as a warning with words', async () => {
    show(CONNECTED);
    const check = vi
      .spyOn(cloudflareApi, 'check')
      .mockResolvedValue({ ...CONNECTED, problem: CLOUDFLARE_PROBLEMS.unreachable });
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    const note = await screen.findByRole('note');
    expect(check).toHaveBeenCalledTimes(1);
    expect(note.textContent).toContain(CLOUDFLARE_PROBLEMS.unreachable);
    expect(note.querySelector('svg')).not.toBeNull();
  });

  it('confirms before disconnecting and says shared pages stay up', async () => {
    const { load } = show(CONNECTED);
    const disconnect = vi.spyOn(cloudflareApi, 'disconnect').mockResolvedValue(null);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Disconnect Cloudflare?' });
    expect(dialog.textContent).toContain(
      'Pages already shared stay up until they expire or you stop sharing them.',
    );
    expect(disconnect).not.toHaveBeenCalled();
    load.mockResolvedValue(NOT_CONNECTED);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await screen.findByLabelText('Service address');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('Cloudflare on a paired device', () => {
  it('is hidden and asks the server nothing', async () => {
    const { load, view } = show(CONNECTED, true);
    await waitFor(() => expect(phoneApi.session).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector('li')).toBeNull());
    expect(load).not.toHaveBeenCalled();
  });
});

const step = (
  id: CloudflareSetup['steps'][number]['id'],
  state: CloudflareSetup['steps'][number]['state'],
  more: Partial<CloudflareSetup['steps'][number]> = {},
) => ({ id, state, problem: null, fix: null, fixUrl: null, ...more });

const OFFERED: CloudflareSetup = {
  available: true,
  status: 'idle',
  authorizeUrl: null,
  account: null,
  permissions: [
    { id: 'account', state: 'needed' },
    { id: 'storage', state: 'needed' },
    { id: 'workers', state: 'needed' },
  ],
  steps: [
    step('signIn', 'todo'),
    step('bucket', 'todo'),
    step('worker', 'todo'),
    step('connect', 'todo'),
  ],
};

describe('setting Cloudflare up for the user', () => {
  it('lists what it asks Cloudflare for before sending the user there', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const authorizeUrl = 'https://dash.cloudflare.com/oauth2/auth?client_id=x';
    const start = vi
      .spyOn(cloudflareApi, 'startSetup')
      .mockResolvedValue({ ...OFFERED, status: 'waiting', authorizeUrl });
    show(NOT_CONNECTED, false, OFFERED);

    const asks = await screen.findByRole('list', { name: 'What Spark asks Cloudflare for' });
    expect(within(asks).getAllByRole('listitem')).toHaveLength(3);
    expect(asks.textContent).toContain('Workers: Admin');
    expect(asks.textContent).toContain('changes no other');
    expect(screen.getByText('Set it up by hand instead')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Allow on Cloudflare/ }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(authorizeUrl, '_blank', 'noopener,noreferrer'),
    );
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Waiting for you to allow Spark in Cloudflare.',
    );
  });

  it('shows a stopped set-up as a checklist with a fix for the step that needs the user', async () => {
    const stopped: CloudflareSetup = {
      ...OFFERED,
      status: 'stopped',
      account: 'Hazel’s account',
      steps: [
        step('signIn', 'done'),
        step('bucket', 'failed', {
          problem: 'R2 storage isn’t turned on in this Cloudflare account.',
          fix: 'cloudflare',
          fixUrl: 'https://dash.cloudflare.com/acc/r2/overview',
        }),
        step('worker', 'todo'),
        step('connect', 'todo'),
      ],
    };
    const start = vi.spyOn(cloudflareApi, 'startSetup').mockResolvedValue(stopped);
    show(NOT_CONNECTED, false, stopped);

    const steps = await screen.findByRole('list', { name: 'Set-up steps' });
    const [signIn, bucket] = within(steps).getAllByRole('listitem');
    expect(signIn!.textContent).toContain('Done');
    expect(bucket!.textContent).toContain('Needs you');
    expect(within(bucket!).getByRole('alert').textContent).toContain('R2 storage');
    expect(within(bucket!).getByRole('link', { name: /^Open Cloudflare/ })).toHaveProperty(
      'href',
      'https://dash.cloudflare.com/acc/r2/overview',
    );
    expect(screen.getByRole('status').textContent).toBe(
      '1 of 4 steps done in Hazel’s account. Finished steps are kept.',
    );
    fireEvent.click(within(bucket!).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('offers to try again when the set-up state can’t be loaded, then shows the form once', async () => {
    show(NOT_CONNECTED);
    const load = vi.spyOn(cloudflareApi, 'setup').mockRejectedValueOnce(new Error('No answer.'));
    expect((await screen.findByRole('alert')).textContent).toBe('No answer.');
    expect(screen.queryByLabelText('Service address')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Service address')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
