// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@spark-outpost/contracts';

const gitInit = vi.hoisted(() => vi.fn());
vi.mock('../api/projects.ts', () => ({
  projectKeys: { git: (id: string) => ['project-git', id] },
  projectsApi: { gitInit },
}));

const { NotGitDialog } = await import('./NotGitDialog.tsx');

afterEach(cleanup);

const PROJECT: Project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'notes',
  rootPath: '/Users/maya/notes',
  displayPath: '~/notes',
  createdAt: '2026-10-01T00:00:00Z',
  commandAllowlist: [],
};

function show(problem: string | null, onDone = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <NotGitDialog project={PROJECT} problem={problem} inline={false} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('NotGitDialog', () => {
  it('leaves a plain folder alone unless the user turns the switch on', async () => {
    const onDone = show(null);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(document.activeElement).toBe(done);
    const toggle = screen.getByRole('switch', { name: 'Make it a git repository' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(done);
    expect(gitInit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('makes the repository when asked', async () => {
    gitInit.mockResolvedValue({ branch: 'main', repository: true, problem: null });
    const onDone = show(null);
    fireEvent.click(screen.getByRole('switch', { name: 'Make it a git repository' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(gitInit).toHaveBeenCalledWith(PROJECT.id);
  });

  it('shows why git could not tell, and offers no switch', () => {
    show('Git took too long to answer.');
    expect(screen.getByRole('dialog').textContent).toContain('Git took too long to answer.');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
