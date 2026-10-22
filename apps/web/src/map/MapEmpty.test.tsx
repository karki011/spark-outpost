// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapEmpty, MapUnreachable, projectListView } from './MapEmpty.tsx';

vi.mock('../brand/ProviderBlob.tsx', () => ({ ProviderBlob: () => null }));
vi.mock('../api/projects.ts', () => ({
  projectKeys: { all: ['projects'], folders: (path: string | null) => ['folders', path] },
  projectsApi: {
    create: vi.fn(),
    folders: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock('../api/setup.ts', () => ({
  setupKey: ['setup'],
  setupApi: { get: vi.fn(() => new Promise(() => {})) },
}));

afterEach(cleanup);

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('projectListView', () => {
  it('shows the empty state only when the list truly came back empty', () => {
    expect(projectListView({ status: 'success', data: [] })).toBe('empty');
    expect(projectListView({ status: 'pending', data: undefined })).toBe('map');
    expect(projectListView({ status: 'error', data: undefined })).toBe('unreachable');
    expect(projectListView({ status: 'error', data: [] })).toBe('unreachable');
  });

  it('keeps showing the map when a refresh fails but projects are known', () => {
    expect(projectListView({ status: 'error', data: [{ id: 'p' }] })).toBe('map');
    expect(projectListView({ status: 'success', data: [{ id: 'p' }] })).toBe('map');
  });
});

describe('MapEmpty', () => {
  it('explains the map and asks to add a project from Add a project', () => {
    const onAdd = vi.fn();
    renderWithClient(<MapEmpty canAdd onAdd={onAdd} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Your code, as a night sky' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'See the shape of a repo',
      'Know what’s Core',
      'See what a chat changed',
      'Link frontend and backend',
    ]);
    expect(screen.getByText(/never slow down chats/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a project' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('shows Add a project disabled when a paired device may not add folders', () => {
    renderWithClient(<MapEmpty canAdd={false} onAdd={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add a project' })).toHaveProperty('disabled', true);
  });
});

describe('MapUnreachable', () => {
  it('offers a retry instead of asking to add a project', () => {
    const onRetry = vi.fn();
    renderWithClient(<MapUnreachable retrying={false} onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Add a project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while a retry is in flight', () => {
    const onRetry = vi.fn();
    renderWithClient(<MapUnreachable retrying onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toBe('Trying again…');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
