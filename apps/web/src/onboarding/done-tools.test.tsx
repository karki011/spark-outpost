// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_APP_SIGNED_OUT,
  type GitHubConnectionStatus,
  type GitStatus,
  type TicketConnection,
  type TicketConnections,
} from '@spark-outpost/contracts';
import { shipKeys } from '../ship/ship-api.ts';
import { ticketKeys } from '../tickets/tickets-api.ts';
import { useGitItem, useToolItems } from './done-tools.tsx';
import { gitStatusQuery } from './git-status.ts';

afterEach(cleanup);

const NO_GITHUB: GitHubConnectionStatus = {
  active: null,
  ghCli: { installed: false, host: 'github.com', login: null },
  token: null,
  app: GITHUB_APP_SIGNED_OUT,
};

const linear = {
  source: 'linear',
  account: 'ada@example.com',
  siteUrl: null,
  validatedAt: '2026-09-30T10:00:00.000Z',
  keySaved: true,
  moveOnShip: false,
  moveOnMerge: false,
  statusMap: {},
} as unknown as TicketConnection;

function seeded(github: GitHubConnectionStatus, tickets: TicketConnections, git?: GitStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(shipKeys.github, github);
  client.setQueryData(ticketKeys.connections, tickets);
  if (git) client.setQueryData(gitStatusQuery.queryKey, git);
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('done step summary', () => {
  it('lists the tools connected during setup', () => {
    const github: GitHubConnectionStatus = {
      ...NO_GITHUB,
      active: 'gh_cli',
      ghCli: { installed: true, host: 'github.com', login: 'ada' },
    };
    const wrapper = seeded(github, {
      connections: [linear, { ...linear, source: 'jira', keySaved: false }],
    });
    const { result } = renderHook(useToolItems, { wrapper });
    expect(result.current.map((item) => [item.key, item.detail])).toEqual([
      ['github', 'Connected through the gh CLI as ada'],
      ['linear', 'Connected to Linear as ada@example.com'],
    ]);
  });

  it('points to Settings when no tool is connected', () => {
    const { result } = renderHook(useToolItems, {
      wrapper: seeded(NO_GITHUB, { connections: [] }),
    });
    expect(result.current.map((item) => item.key)).toEqual(['tools']);
  });

  it('shows the git version, or that git is missing and needed for Do chats', () => {
    const found = renderHook(useGitItem, {
      wrapper: seeded(
        NO_GITHUB,
        { connections: [] },
        { installed: true, version: '2.47.1', canInstall: true },
      ),
    });
    expect(found.result.current?.detail).toBe('Each Do chat gets its own worktree');
    const missing = renderHook(useGitItem, {
      wrapper: seeded(
        NO_GITHUB,
        { connections: [] },
        { installed: false, version: null, canInstall: true },
      ),
    });
    expect(missing.result.current?.detail).toBe('Needed for Do chats');
  });
});
