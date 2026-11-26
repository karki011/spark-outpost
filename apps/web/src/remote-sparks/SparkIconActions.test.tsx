// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalSpark, RemoteSpark, RemoteSparkList } from '@spark-outpost/contracts';
import { OtherSparks } from './OtherSparks.tsx';
import { ICON_PROBLEM, OTHER_SPARKS_EMPTY } from './remote-sparks-copy.ts';

const canvas = vi.hoisted(() => ({ fails: false }));
vi.mock('./spark-icon-canvas.ts', () => ({
  drawSquarePng: () =>
    canvas.fails
      ? Promise.reject(new Error('InvalidStateError'))
      : Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])])),
}));

const SETTLE = { timeout: 3000 };
const NOTE = 'The other computer sees this name when this one pairs. Icons stay on this computer.';
const LOCAL: LocalSpark = { name: null, defaultName: 'Hazel’s MacBook', icon: null };
const STUDIO: RemoteSpark = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Studio Mac',
  hostname: 'studio.tail1234.ts.net',
  reach: 'tailscale',
  paired: true,
  status: 'online',
  needsYou: 0,
  icon: null,
  createdAt: '2026-11-20T10:00:00Z',
  lastOpenedAt: null,
};
const STUDIO_ICON = `/api/remote-sparks/${STUDIO.id}/icon?v=2`;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function serve(list: RemoteSparkList): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        calls.push({
          method,
          path: String(url),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
      }
      return new Response(JSON.stringify(method === 'GET' ? list : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

async function show(list: Partial<RemoteSparkList> = {}) {
  const calls = serve({ available: true, local: LOCAL, sparks: [STUDIO], ...list });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OtherSparks ownHostname="mine.tail1234.ts.net" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0), SETTLE);
  const [own, studio] = screen.getAllByRole('listitem');
  return { calls, own: own!, studio: studio! };
}

function menuOf(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  const menu = within(screen.getByRole('menu', { name: `Actions for ${name}` }));
  return {
    labels: menu.getAllByRole('menuitem').map((item) => item.textContent),
    choose: (label: string) => fireEvent.click(menu.getByRole('menuitem', { name: label })),
  };
}

function pick(name: string, file: File) {
  const input = screen.getByLabelText<HTMLInputElement>(`Icon for ${name}`);
  expect(input.type).toBe('file');
  expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
  fireEvent.change(input, { target: { files: [file] } });
}

const LOGO = new File(['picture'], 'logo.jpg', { type: 'image/jpeg' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  canvas.fails = false;
});

describe('a saved Spark’s icon', () => {
  it('opens the file picker from Change icon… and saves the picture as base64 PNG', async () => {
    const { calls, studio } = await show();
    const input = screen.getByLabelText<HTMLInputElement>('Icon for Studio Mac');
    const opened = vi.spyOn(input, 'click');
    const menu = menuOf('Studio Mac');
    expect(menu.labels).toEqual(['Rename', 'Change icon…', 'Remove…']);
    menu.choose('Change icon…');
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(
      within(studio).getByRole('button', { name: 'Actions for Studio Mac' }),
    );
    pick('Studio Mac', LOGO);
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: `/api/remote-sparks/${STUDIO.id}/icon`,
      body: { png: 'iVBORw0KGgo=' },
    });
    expect(within(studio).queryByRole('alert')).toBeNull();
  });

  it('shows the image and offers Remove icon only once there is one', async () => {
    const { calls, studio } = await show({ sparks: [{ ...STUDIO, icon: STUDIO_ICON }] });
    expect(studio.querySelector('img')?.getAttribute('src')).toBe(STUDIO_ICON);
    const menu = menuOf('Studio Mac');
    expect(menu.labels).toEqual(['Rename', 'Change icon…', 'Remove icon', 'Remove…']);
    menu.choose('Remove icon');
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      path: `/api/remote-sparks/${STUDIO.id}/icon`,
    });
  });

  it('says one line and sends nothing when the picture cannot be used', async () => {
    canvas.fails = true;
    const { calls, studio } = await show();
    pick('Studio Mac', LOGO);
    expect((await within(studio).findByRole('alert')).textContent).toBe(ICON_PROBLEM);
    expect(calls).toHaveLength(0);
  });
});

describe('the This computer row', () => {
  it('is first, shows the computer name and stays with no Spark saved', async () => {
    const { own } = await show({ sparks: [] });
    expect(within(own).getByText('Hazel’s MacBook').tagName).toBe('B');
    expect(within(own).getByText('This computer')).toBeTruthy();
    expect(within(own).getByText(NOTE)).toBeTruthy();
    expect(own.querySelector('.rs-icon svg')).toBeTruthy();
    expect(within(own).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(screen.getByText(OTHER_SPARKS_EMPTY)).toBeTruthy();
    expect(menuOf('This computer').labels).toEqual(['Rename', 'Change icon…']);
  });

  it('renames this computer', async () => {
    const { calls } = await show();
    menuOf('This computer').choose('Rename');
    const field = screen.getByLabelText<HTMLInputElement>('New name for This computer');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: ' Office ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: '/api/remote-sparks/local',
      body: { name: 'Office' },
    });
  });

  it('shows a custom name with This computer beside it and clears it two ways', async () => {
    const { calls, own } = await show({ local: { ...LOCAL, name: 'Office' } });
    expect(within(own).getByText('Office').tagName).toBe('B');
    expect(within(own).getByText('This computer')).toBeTruthy();
    expect(within(own).queryByText('Hazel’s MacBook')).toBeNull();
    const menu = menuOf('This computer');
    expect(menu.labels).toEqual(['Rename', 'Use computer name', 'Change icon…']);
    menu.choose('Use computer name');
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    menuOf('This computer').choose('Rename');
    const field = screen.getByLabelText<HTMLInputElement>('New name for This computer');
    expect(field.value).toBe('Office');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toHaveLength(2), SETTLE);
    const cleared = { method: 'PUT', path: '/api/remote-sparks/local', body: { name: null } };
    expect(calls).toEqual([cleared, cleared]);
  });

  it('saves and removes this computer’s icon', async () => {
    const icon = '/api/remote-sparks/local/icon?v=1';
    const { calls, own } = await show({ local: { ...LOCAL, icon } });
    expect(own.querySelector('img')?.getAttribute('src')).toBe(icon);
    pick('This computer', LOGO);
    await waitFor(() => expect(calls).toHaveLength(1), SETTLE);
    expect(calls[0]).toEqual({
      method: 'PUT',
      path: '/api/remote-sparks/local/icon',
      body: { png: 'iVBORw0KGgo=' },
    });
    const menu = menuOf('This computer');
    expect(menu.labels).toEqual(['Rename', 'Change icon…', 'Remove icon']);
    menu.choose('Remove icon');
    await waitFor(() => expect(calls).toHaveLength(2), SETTLE);
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/api/remote-sparks/local/icon' });
  });
});
