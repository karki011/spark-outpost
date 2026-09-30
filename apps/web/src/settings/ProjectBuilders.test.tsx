// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@spark-outpost/contracts';
import { ProjectBuilders } from './ProjectBuilders.tsx';

const SETTLE = { timeout: 3000 };

const PROJECT: Project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'app',
  rootPath: '/work/app',
  displayPath: '~/work/app',
  createdAt: '2026-09-30T00:00:00.000Z',
  commandAllowlist: [],
  checkCommands: null,
  parallelPieces: true,
  pieceSlots: 3,
  workPlace: 'worktree',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function server() {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const change = JSON.parse(String(init?.body ?? '{}')) as Partial<Project>;
      bodies.push(change);
      return new Response(JSON.stringify({ ...PROJECT, ...change }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return bodies;
}

function show(project: Project, available: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectBuilders project={project} available={available} />
    </QueryClientProvider>,
  );
}

const slotsPicker = () => screen.getByRole('button', { name: 'Builders at once in app' });
const placePicker = () => screen.getByRole('button', { name: 'Where Spark works in app' });

describe('Builder settings for a project', () => {
  it('runs Builders in parallel by default with no on/off switch', () => {
    server();
    show(PROJECT, true);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(slotsPicker().textContent).toContain('Up to 3 at once');
    expect(screen.getByText(/run at the same time/)).toBeTruthy();
  });

  it('picks how many Builders run at once, and 1 means in order', async () => {
    const bodies = server();
    show(PROJECT, true);
    fireEvent.click(slotsPicker());
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1 at a time, in order' }));
    await vi.waitFor(() => expect(bodies).toEqual([{ pieceSlots: 1 }]), SETTLE);
    cleanup();
    show({ ...PROJECT, pieceSlots: 1 }, true);
    expect(slotsPicker().textContent).toContain('1 at a time, in order');
    expect(screen.getByText('Pieces of a big plan run one after another.')).toBeTruthy();
  });

  it('shows one at a time and explains why when the server runs pieces in order', () => {
    const bodies = server();
    show(PROJECT, false);
    expect(slotsPicker().textContent).toContain('1 at a time, in order');
    expect(screen.getByText(/COORDINATOR_MODE/, { selector: 'p' })).toBeTruthy();
    fireEvent.click(slotsPicker());
    const three = screen.getByRole('menuitemradio', { name: /Up to 3 at once/ });
    expect(three.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /1 at a time/ }));
    expect(bodies).toEqual([]);
  });

  it('works in its own worktree by default and can switch to the folder itself', async () => {
    const bodies = server();
    show(PROJECT, true);
    expect(placePicker().textContent).toContain('Each chat in its own worktree (recommended)');
    fireEvent.click(placePicker());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'In my files' }));
    await vi.waitFor(() => expect(bodies).toEqual([{ workPlace: 'checkout' }]), SETTLE);
    cleanup();
    show({ ...PROJECT, workPlace: 'checkout' }, true);
    expect(placePicker().textContent).toContain('In my files');
    expect(screen.getByText('New chats edit the files in this folder directly.')).toBeTruthy();
  });
});
