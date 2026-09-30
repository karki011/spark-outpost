// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  parallelPieces: false,
  pieceSlots: 3,
  stableCheckout: false,
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

const parallel = () => screen.getByRole('switch', { name: 'Let Builders work in parallel in app' });

describe('Builder settings for a project', () => {
  it('turns parallel Builders on and saves only that setting', async () => {
    const bodies = server();
    show(PROJECT, true);
    expect(parallel().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'How many at once in app' })).toBeNull();

    fireEvent.click(parallel());
    await vi.waitFor(() => expect(bodies).toEqual([{ parallelPieces: true }]), SETTLE);
  });

  it('picks how many pieces run at once from the app dropdown', async () => {
    const bodies = server();
    show({ ...PROJECT, parallelPieces: true }, true);
    const picker = screen.getByRole('button', { name: 'How many at once in app' });
    expect(picker.textContent).toContain('Up to 3 at once');

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Up to 2 at once' }));
    await vi.waitFor(() => expect(bodies).toEqual([{ pieceSlots: 2 }]), SETTLE);
  });

  it('keeps the toggle off and explains why when the server runs pieces one at a time', () => {
    vi.useFakeTimers();
    server();
    show({ ...PROJECT, parallelPieces: true }, false);
    expect(parallel().hasAttribute('disabled')).toBe(true);
    expect(parallel().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'How many at once in app' })).toBeNull();

    const anchor = parallel().parentElement!;
    fireEvent.pointerEnter(anchor, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip').textContent).toContain('COORDINATOR_MODE=parallel');
  });

  it('keeps the folder untouched when asked', async () => {
    const bodies = server();
    show(PROJECT, false);
    fireEvent.click(screen.getByRole('switch', { name: 'Keep this folder untouched: app' }));
    await vi.waitFor(() => expect(bodies).toEqual([{ stableCheckout: true }]), SETTLE);
  });
});
