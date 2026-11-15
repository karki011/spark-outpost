// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConnector } from '@spark-outpost/contracts';

const opened = vi.hoisted(() => ({ sections: [] as string[] }));
vi.mock('../../settings/settings-request.ts', () => ({
  requestSettings: (section: string) => opened.sections.push(section),
}));

const { RailConnectors } = await import('./RailConnectors.tsx');

function serve(connectors: AgentConnector[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ connectors }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RailConnectors />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  opened.sections.length = 0;
});

describe('connectors in the context rail', () => {
  it('lists what the agent gets, a switch that is off, and folds the rest into one line', async () => {
    serve([
      { id: 'github', state: 'on' },
      { id: 'jira', state: 'on' },
      { id: 'confluence', state: 'switch_off' },
      { id: 'linear', state: 'not_connected' },
      { id: 'servicenow', state: 'not_connected' },
      { id: 'slack', state: 'not_connected' },
      { id: 'calendar', state: 'on' },
    ]);
    show();

    const list = await screen.findByRole('list', { name: 'Connectors' });
    expect(list.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText('Pull requests and repos')).toBeTruthy();
    expect(screen.getAllByText('On')).toHaveLength(3);
    expect(screen.getByText('Off on the Atlassian card')).toBeTruthy();
    expect(screen.getByText(/Not connected: Linear, ServiceNow, Slack\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on Confluence for agents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect…' }));
    expect(opened.sections).toEqual(['tools', 'tools']);
  });
});
