// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GITHUB_APP_SIGNED_OUT,
  type GitHubAppSignIn,
  type GitHubAppStatus,
  type GitHubConnectionStatus,
} from '@spark-outpost/contracts';
import { GitHubCard } from './GitHubCard.tsx';
import { shipKeys } from './ship-api.ts';

afterEach(cleanup);

const IDLE: GitHubAppSignIn = {
  status: 'idle',
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: null,
};

function status(app: Partial<GitHubAppStatus>): GitHubConnectionStatus {
  return {
    active: app.state === 'connected' ? 'app' : null,
    ghCli: { installed: false, host: 'github.com', login: null },
    token: null,
    app: { ...GITHUB_APP_SIGNED_OUT, ...app },
  };
}

function show(connection: GitHubConnectionStatus, flow: GitHubAppSignIn = IDLE) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(shipKeys.github, connection);
  client.setQueryData(shipKeys.githubSignIn, flow);
  render(
    <QueryClientProvider client={client}>
      <ul>
        <GitHubCard icon={null} open onToggle={() => undefined} />
      </ul>
    </QueryClientProvider>,
  );
}

const methodNames = () => screen.getAllByRole('radio').map((radio) => radio.textContent);

describe('the GitHub card', () => {
  it('hides GitHub sign-in when the build has no GitHub App', () => {
    show(status({ available: false }));
    expect(methodNames()).toEqual(['gh CLI', 'Personal token']);
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
    expect(screen.getByLabelText('Personal access token')).toBeTruthy();
  });

  it('offers GitHub sign-in first when the build has one, with the token as the other way', () => {
    show(status({ available: true }));
    expect(methodNames()).toEqual(['GitHub sign-in', 'gh CLI', 'Personal token']);
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use a token instead' })).toBeTruthy();
  });

  it('shows the code of a sign-in that is already under way', () => {
    show(status({ available: true }), {
      status: 'waiting',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-10-04T10:15:00.000Z',
      message: null,
    });
    expect(screen.getByRole('group', { name: 'GitHub sign-in code' }).textContent).toContain(
      'WDJB-MJHT',
    );
    expect(screen.getByRole('link', { name: 'Open GitHub' }).getAttribute('href')).toBe(
      'https://github.com/login/device',
    );
  });

  it('names uncovered projects and where to give access', () => {
    show(
      status({
        available: true,
        state: 'connected',
        login: 'octo-app',
        installUrl: 'https://github.com/apps/spark/installations/new',
        repos: ['acme/other'],
        projects: [{ project: 'widgets', repo: 'acme/widgets', covered: false }],
      }),
    );
    expect(screen.getByText('Signed in as @octo-app')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Give Spark access to this repo' }).getAttribute('href'),
    ).toBe('https://github.com/apps/spark/installations/new');
  });
});
