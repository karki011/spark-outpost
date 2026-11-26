// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_DOMAIN_PROBLEMS,
  REMOTE_CARD_ANSWERING_DEFAULT,
  REMOTE_SWITCH_DEFAULTS,
  type RemoteAccess,
  type RemoteSession,
  type TailscaleState,
} from '@spark-outpost/contracts';
import {
  CONFIRM_LABEL,
  CUSTOM_ON_NOTE,
  DOMAIN_PROBLEMS,
  FORWARD_UNKNOWN,
  PAIR_AGAIN_NOTE,
  REPLACES_CUSTOM,
  REPLACES_TAILSCALE,
  WARNING_LEAD,
  parseCustomDomain,
} from './custom-domain.ts';
import { MacPhonePage } from './MacPhonePage.tsx';
import { onNote } from './phone-copy.ts';

const SETTLE = { timeout: 3000 };
const FORWARD = 'http://127.0.0.1:34344';
const OFF: TailscaleState = { status: 'off', hostname: null, address: null, message: null };
const TAILSCALE_ON: TailscaleState = {
  status: 'on',
  hostname: 'mac.tail1234.ts.net',
  address: 'https://mac.tail1234.ts.net',
  message: null,
};

function accessOf(hostname: string | null, forwardTo: string | null = FORWARD): RemoteAccess {
  return {
    hostname,
    reach: hostname !== null && !hostname.endsWith('.ts.net') ? 'custom' : 'tailscale',
    forwardTo,
    switches: { ...REMOTE_SWITCH_DEFAULTS },
    cardAnswering: { ...REMOTE_CARD_ANSWERING_DEFAULT },
  };
}

interface Served {
  tailscale: TailscaleState;
  access: RemoteAccess;
  refuse?: string;
}

function serve(served: Served) {
  const puts: unknown[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/remote/access')) {
        if (init?.method !== 'PUT') return json(served.access);
        const body = JSON.parse(String(init.body)) as { hostname: string | null };
        puts.push(body);
        if (served.refuse) return json({ error: served.refuse }, 400);
        served.access = accessOf(body.hostname);
        return json(served.access);
      }
      if (path.endsWith('/remote/tailscale')) return json(served.tailscale);
      if (path.endsWith('/remote/devices')) return json({ devices: [] });
      if (path.endsWith('/remote/audit')) return json({ entries: [] });
      if (path.endsWith('/remote/pairings')) return json({ pairings: [] });
      return json({ error: 'Not served in this test.' }, 404);
    }),
  );
  return puts;
}

async function show(served: Served) {
  const puts = serve(served);
  const session: RemoteSession = {
    remote: false,
    host: 'mac',
    device: null,
    address: served.access.hostname ? `https://${served.access.hostname}` : null,
    switches: { ...REMOTE_SWITCH_DEFAULTS },
    cardAnswering: { ...REMOTE_CARD_ANSWERING_DEFAULT },
    passkey: false,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MacPhonePage session={session} />
    </QueryClientProvider>,
  );
  await screen.findByRole('radiogroup', { name: 'How devices reach this computer' }, SETTLE);
  return puts;
}

function choose(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

function checked(name: string): string | null {
  return screen.getByRole('radio', { name }).getAttribute('aria-checked');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('parseCustomDomain', () => {
  it.each([
    ['spark.example.com', 'spark.example.com'],
    ['https://Spark.Example.com/', 'spark.example.com'],
  ])('takes %s', (input, hostname) => {
    expect(parseCustomDomain(input)).toEqual({ ok: true, hostname });
  });

  it.each([
    ['', DOMAIN_PROBLEMS.empty],
    ['http://spark.example.com', DOMAIN_PROBLEMS.scheme],
    ['spark.example.com:8443', DOMAIN_PROBLEMS.shape],
    ['spark.example.com/app', DOMAIN_PROBLEMS.shape],
    ['https://me:pw@spark.example.com', DOMAIN_PROBLEMS.shape],
    ['spark.example.com?x=1', DOMAIN_PROBLEMS.shape],
    ['spark.example.com/#code=ABCD', DOMAIN_PROBLEMS.shape],
    ['203.0.113.7', DOMAIN_PROBLEMS.host],
    ['localhost', DOMAIN_PROBLEMS.host],
    ['mac.tail1234.ts.net', CUSTOM_DOMAIN_PROBLEMS.tailscale],
  ])('refuses %s in one line', (input, problem) => {
    expect(parseCustomDomain(input)).toEqual({ ok: false, problem });
  });
});

describe('how devices reach this computer', () => {
  it('starts on Tailscale with its steps and no custom domain fields', async () => {
    await show({ tailscale: OFF, access: accessOf(null) });
    expect(checked('Tailscale')).toBe('true');
    expect(checked('Custom domain')).toBe('false');
    expect(screen.getByRole('list', { name: 'Set up remote control' })).toBeTruthy();
    expect(screen.queryByLabelText('Domain')).toBeNull();
    expect(screen.queryByText(REPLACES_CUSTOM)).toBeNull();
  });

  it('shows the custom domain form with where to forward requests', async () => {
    await show({ tailscale: OFF, access: accessOf(null) });
    choose('Custom domain');
    expect(screen.queryByRole('list', { name: 'Set up remote control' })).toBeNull();
    expect(screen.getByLabelText('Domain')).toBeTruthy();
    const forward = within(screen.getByRole('group', { name: 'Forward requests to' }));
    expect(forward.getByText(FORWARD).tagName).toBe('CODE');
    expect(forward.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText(WARNING_LEAD).tagName).toBe('B');
    expect(screen.queryByText(REPLACES_TAILSCALE)).toBeNull();
  });

  it('says the address comes later while the port is unknown', async () => {
    await show({ tailscale: OFF, access: accessOf(null, null) });
    choose('Custom domain');
    expect(screen.getByText(FORWARD_UNKNOWN)).toBeTruthy();
  });

  it('keeps Turn on disabled until the box is ticked and sends the confirmation', async () => {
    const puts = await show({ tailscale: OFF, access: accessOf(null) });
    choose('Custom domain');
    const turnOn = screen.getByRole('button', { name: 'Turn on' });
    expect(turnOn).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Domain'), {
      target: { value: 'http://spark.example.com' },
    });
    expect(screen.getByText(DOMAIN_PROBLEMS.scheme)).toBeTruthy();
    expect(screen.getByLabelText('Domain').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    expect(turnOn).toHaveProperty('disabled', false);
    fireEvent.click(turnOn);
    expect(puts).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Domain'), {
      target: { value: ' https://spark.example.com ' },
    });
    fireEvent.click(turnOn);
    await screen.findByText(CUSTOM_ON_NOTE, undefined, SETTLE);
    expect(puts).toEqual([{ hostname: 'spark.example.com', confirmed: true }]);
    expect(screen.getByText(PAIR_AGAIN_NOTE)).toBeTruthy();
    expect(screen.getByText('https://spark.example.com')).toBeTruthy();
    expect(screen.queryByText(onNote())).toBeNull();
    expect(checked('Custom domain')).toBe('true');
  });

  it('shows what the server refused and stays on the form', async () => {
    await show({
      tailscale: OFF,
      access: accessOf(null),
      refuse: CUSTOM_DOMAIN_PROBLEMS.unconfirmed,
    });
    choose('Custom domain');
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'spark.example.com' } });
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    const alert = await screen.findByText(CUSTOM_DOMAIN_PROBLEMS.unconfirmed, undefined, SETTLE);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('Domain')).toBeTruthy();
  });

  it('turns a custom domain off and stays on its form', async () => {
    const puts = await show({ tailscale: OFF, access: accessOf('spark.example.com') });
    expect(checked('Custom domain')).toBe('true');
    expect(screen.getByText(CUSTOM_ON_NOTE)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Remote control' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await screen.findByLabelText('Domain', undefined, SETTLE);
    expect(puts).toEqual([{ hostname: null }]);
    expect(checked('Custom domain')).toBe('true');
  });

  it('says what switching replaces, both ways', async () => {
    await show({ tailscale: TAILSCALE_ON, access: accessOf(TAILSCALE_ON.hostname) });
    expect(screen.getByText(onNote())).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Remote control' })).toBeTruthy();
    choose('Custom domain');
    expect(screen.getByText(REPLACES_TAILSCALE)).toBeTruthy();
    cleanup();
    await show({ tailscale: OFF, access: accessOf('spark.example.com') });
    choose('Tailscale');
    await waitFor(() => expect(screen.getByText(REPLACES_CUSTOM)).toBeTruthy(), SETTLE);
    expect(screen.getByRole('list', { name: 'Set up remote control' })).toBeTruthy();
  });
});
