// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@spark-outpost/contracts';
import { ProjectWorkPlace } from './ProjectWorkPlace.tsx';

const SETTLE = { timeout: 3000 };

const PROJECT: Project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'app',
  rootPath: '/work/app',
  displayPath: '~/work/app',
  createdAt: '2026-09-30T00:00:00.000Z',
  commandAllowlist: [],
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

function show(project: Project) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectWorkPlace project={project} />
    </QueryClientProvider>,
  );
}

const placePicker = () => screen.getByRole('button', { name: 'Where Spark works in app' });

describe('Where Spark works for a project', () => {
  it('works in its own worktree by default and can switch to the folder itself', async () => {
    const bodies = server();
    show(PROJECT);
    expect(placePicker().textContent).toContain('Each chat in its own worktree (recommended)');
    fireEvent.click(placePicker());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'In my files' }));
    await vi.waitFor(() => expect(bodies).toEqual([{ workPlace: 'checkout' }]), SETTLE);
    cleanup();
    show({ ...PROJECT, workPlace: 'checkout' });
    expect(placePicker().textContent).toContain('In my files');
    expect(screen.getByText('New chats edit the files in this folder directly.')).toBeTruthy();
  });
});
