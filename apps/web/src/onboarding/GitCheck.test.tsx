// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '@spark-outpost/contracts';
import { GitCheck } from './GitCheck.tsx';

const FOUND: GitStatus = { installed: true, version: '2.47.1', canInstall: true };
const MISSING: GitStatus = { installed: false, version: null, canInstall: true };
const SETTLE = { timeout: 3000 };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function server(checks: GitStatus[], install: Response = json(MISSING)) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'POST') return install;
      return json(checks.shift() ?? FOUND);
    }),
  );
  return calls;
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GitCheck />
    </QueryClientProvider>,
  );
  return screen.getByRole('region', { name: 'Git' });
}

describe('onboarding git check', () => {
  it('shows the blob looking for git, then the version it found', async () => {
    server([FOUND]);
    const card = show();
    expect(card).toHaveProperty('ariaBusy', 'true');
    expect(card.textContent).toContain('Spark is looking for Git…');
    await screen.findByText('Git 2.47.1', undefined, SETTLE);
    expect(card.textContent).toContain('Found');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a missing git, opens the installer, and checks again', async () => {
    const calls = server([MISSING, FOUND]);
    show();
    await screen.findByText('Git not installed', undefined, SETTLE);
    expect(screen.getByText(/its own git worktree/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Install Xcode Command Line Tools' }));
    await screen.findByText(/Follow Apple’s installer/);
    expect(calls).toContain('POST /api/setup/git/install');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Git 2.47.1', undefined, SETTLE);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });

  it('offers the command to copy when the installer cannot open', async () => {
    server([MISSING], json({ error: 'Couldn’t open Apple’s installer.' }, 400));
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Install Xcode Command Line Tools' }, SETTLE),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t open');
    expect(screen.getByText('xcode-select --install')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('links to the Git download page where the installer is not available', async () => {
    server([{ ...MISSING, canInstall: false }]);
    show();
    const link = await screen.findByRole('link', { name: /Download Git/ }, SETTLE);
    expect(link.getAttribute('href')).toBe('https://git-scm.com/downloads');
    expect(screen.queryByRole('button', { name: /Install Xcode/ })).toBeNull();
  });
});
