// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSpark, RemoteSparkList } from '@spark-outpost/contracts';
import { useAddSparkRequest } from './add-spark-request.ts';
import { SparkSwitcher } from './SparkSwitcher.tsx';

const client = vi.hoisted(() => ({ remote: false, loaded: true }));
vi.mock('../phone/use-remote-client.ts', () => ({
  useRemoteClient: () => ({
    remote: client.remote,
    allows: () => true,
    session: client.loaded ? { remote: client.remote } : undefined,
  }),
}));

const LOCAL = { name: null, defaultName: 'Hazel’s MacBook', icon: null };
const SETTLE = { timeout: 3000 };
const STUDIO: RemoteSpark = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: true,
  status: 'online',
  needsYou: 2,
  icon: null,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: '2026-11-24T10:00:00Z',
};
const ATTIC: RemoteSpark = {
  ...STUDIO,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Attic Mac',
  hostname: 'attic.tail1234.ts.net',
  status: 'offline',
  needsYou: 1,
};
const CELLAR: RemoteSpark = {
  ...ATTIC,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Cellar Mac',
  paired: false,
  status: 'not-paired',
  needsYou: 0,
};

function serve(list: RemoteSparkList) {
  const calls: { method: string; path: string }[] = [];
  const fetched = vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: String(url) });
    return new Response(JSON.stringify(method === 'GET' ? list : {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetched);
  return calls;
}

function AddProbe({ onAdd }: { onAdd: () => void }) {
  useAddSparkRequest(onAdd);
  return null;
}

async function show(onManage = vi.fn(), onAdd = vi.fn()) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <SparkSwitcher onManage={onManage} />
      <AddProbe onAdd={onAdd} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(queries.isFetching()).toBe(0), SETTLE);
  return { onManage, onAdd };
}

function openMenu() {
  const button = screen.getByRole('button', { name: /^This Mac/ });
  fireEvent.click(button);
  return { button, menu: screen.getByRole('menu', { name: 'Sparks' }) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  client.remote = false;
  client.loaded = true;
});

describe('SparkSwitcher', () => {
  it('shows nothing while no Spark is saved', async () => {
    serve({ available: true, local: LOCAL, sparks: [] });
    await show();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows nothing outside the Mac app', async () => {
    serve({ available: false, local: LOCAL, sparks: [STUDIO] });
    await show();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows nothing and asks for nothing on a paired device or before the session is known', async () => {
    client.remote = true;
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    await show();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    client.remote = false;
    client.loaded = false;
    await show();
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('names this Mac and totals the requests waiting on other Sparks', async () => {
    serve({ available: true, local: LOCAL, sparks: [STUDIO, ATTIC, CELLAR] });
    await show();
    const button = screen.getByRole('button', {
      name: 'This Mac. 3 requests waiting on other Sparks',
    });
    expect(button.textContent).toBe('This Mac3');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('has no badge when nothing waits and says one request in the singular', async () => {
    serve({ available: true, local: LOCAL, sparks: [CELLAR] });
    await show();
    expect(screen.getByRole('button', { name: 'This Mac' }).textContent).toBe('This Mac');
    cleanup();
    serve({ available: true, local: LOCAL, sparks: [ATTIC] });
    await show();
    expect(
      screen.getByRole('button', { name: 'This Mac. 1 request waiting on other Sparks' }),
    ).toBeTruthy();
  });

  it('lists this Mac checked, then each Spark with its status and count', async () => {
    serve({ available: true, local: LOCAL, sparks: [STUDIO, ATTIC, CELLAR] });
    await show();
    const { menu } = openMenu();
    const own = within(menu).getByRole('menuitemradio', { name: 'This Mac' });
    expect(own.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(own);
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Studio MacOnline2 waiting',
      'Attic MacOffline1 waiting',
      'Cellar MacNot paired yet',
      'Add a Spark…',
      'Manage Sparks…',
    ]);
    expect(within(menu).getByRole('separator')).toBeTruthy();
    expect(items[0]!.querySelector('[data-status="online"] svg')).toBeTruthy();
    fireEvent.keyDown(own, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'End' });
    expect(document.activeElement).toBe(items[4]);
  });

  it('opens the chosen Spark and returns focus to the button', async () => {
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO, ATTIC] });
    await show();
    const { button, menu } = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Attic Mac/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    await waitFor(
      () =>
        expect(calls).toContainEqual({
          method: 'POST',
          path: `/api/remote-sparks/${ATTIC.id}/open`,
        }),
      SETTLE,
    );
  });

  it('closes on Esc and on this Mac without opening anything', async () => {
    const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    await show();
    const first = openMenu();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(first.button);
    expect(first.button.getAttribute('aria-expanded')).toBe('false');
    const second = openMenu();
    fireEvent.click(within(second.menu).getByRole('menuitemradio', { name: 'This Mac' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('goes to the page for Manage, and also asks for the Add dialog for Add', async () => {
    serve({ available: true, local: LOCAL, sparks: [STUDIO] });
    const { onManage, onAdd } = await show();
    fireEvent.click(within(openMenu().menu).getByRole('menuitem', { name: 'Manage Sparks…' }));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(within(openMenu().menu).getByRole('menuitem', { name: 'Add a Spark…' }));
    expect(onManage).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows this Mac’s own name and icon, and each Spark’s icon in the menu', async () => {
    const icon = '/api/remote-sparks/local/icon?v=4';
    const studioIcon = `/api/remote-sparks/${STUDIO.id}/icon?v=1`;
    const name = 'Office in the garden shed';
    serve({
      available: true,
      local: { ...LOCAL, name, icon },
      sparks: [{ ...STUDIO, icon: studioIcon }, ATTIC],
    });
    await show();
    const button = screen.getByRole('button', {
      name: `${name}. 3 requests waiting on other Sparks`,
    });
    expect(button.querySelector('img')?.getAttribute('src')).toBe(icon);
    expect(button.querySelector('.rs-switch-name')?.textContent).toBe(name);
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Sparks' });
    const own = within(menu).getByRole('menuitemradio', { name });
    expect(own.querySelector('img')?.getAttribute('src')).toBe(icon);
    const [studio, attic] = within(menu).getAllByRole('menuitem');
    expect(studio!.querySelector('img')?.getAttribute('src')).toBe(studioIcon);
    expect(attic!.querySelector('img')).toBeNull();
    expect(attic!.querySelector('.rs-icon svg')).toBeTruthy();
  });

  it('keeps the laptop and This Mac while this Mac has no name or icon of its own', async () => {
    serve({ available: true, local: LOCAL, sparks: [CELLAR] });
    await show();
    const button = screen.getByRole('button', { name: 'This Mac' });
    expect(button.querySelector('img')).toBeNull();
    expect(button.querySelector('.rs-icon svg')).toBeTruthy();
  });
});
