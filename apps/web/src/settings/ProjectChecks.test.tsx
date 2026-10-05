// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@spark-outpost/contracts';
import { ProjectChecks, commandsFrom } from './ProjectChecks.tsx';

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

function show(project: Project = PROJECT) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectChecks project={project} />
    </QueryClientProvider>,
  );
}

function pick(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Checks after a change in app' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
}

describe('the checks setting of a project', () => {
  it('turns automatic checks off and back on', async () => {
    const bodies = server();
    show();
    expect(screen.getByText(/narrowed to what the change touched/)).toBeTruthy();
    pick('Off');
    await waitFor(() => expect(bodies).toEqual([{ checkCommands: [] }]));
    expect(screen.getByText('Spark runs no checks after a change in this project.')).toBeTruthy();
    pick('Found automatically');
    await waitFor(() => expect(bodies.at(-1)).toEqual({ checkCommands: null }));
  });

  it('saves the commands you type, one per line, and nothing until they are valid', async () => {
    const bodies = server();
    show();
    pick('My commands');
    const field = screen.getByLabelText('Check commands for app');
    const saveButton = screen.getByRole('button', { name: 'Save commands' });
    expect(saveButton).toHaveProperty('disabled', true);
    fireEvent.change(field, {
      target: { value: ' pnpm exec nx affected -t test \n\npnpm run lint\n' },
    });
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(bodies).toEqual([
        { checkCommands: ['pnpm exec nx affected -t test', 'pnpm run lint'] },
      ]),
    );
    fireEvent.change(field, { target: { value: 'a\nb\nc\nd\ne\nf' } });
    expect(screen.getByRole('alert').textContent).toBe('Keep it to 5 commands.');
    expect(saveButton).toHaveProperty('disabled', true);
  });

  it('opens on the saved commands', () => {
    show({ ...PROJECT, checkCommands: ['make test'] });
    expect(screen.getByLabelText('Check commands for app')).toHaveProperty('value', 'make test');
    expect(commandsFrom(' a \n\n b ')).toEqual(['a', 'b']);
  });
});
