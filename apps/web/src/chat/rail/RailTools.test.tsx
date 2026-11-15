// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMcpServer, UserPlugin } from '@spark-outpost/contracts';

const opened = vi.hoisted(() => ({ sections: [] as string[], focus: [] as string[] }));
vi.mock('../../settings/settings-request.ts', () => ({
  requestSettings: (section: string) => opened.sections.push(section),
}));
vi.mock('../../settings/setting-focus.ts', () => ({
  requestSettingFocus: (label: string) => opened.focus.push(label),
}));

const { RailTools } = await import('./RailTools.tsx');

const CHAT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b301';
const SERVER_ID = '11111111-1111-4111-8111-111111111111';

const docs: ChatMcpServer = {
  kind: 'user',
  id: SERVER_ID,
  name: 'docs',
  source: 'user',
  transport: 'stdio',
  fingerprint: 'f1',
  enabled: false,
  via: 'off',
  changed: false,
  check: null,
};

const repoServer: ChatMcpServer = {
  kind: 'project',
  projectId: '22222222-2222-4222-8222-222222222222',
  projectName: 'shop',
  name: 'shop-db',
  transport: 'stdio',
  enabled: true,
  changed: false,
};

function plugin(overrides: Partial<UserPlugin>): UserPlugin {
  return {
    key: 'notes@market',
    name: 'notes',
    marketplace: 'market',
    version: '1.0.0',
    description: 'Notes',
    skills: 2,
    commands: 0,
    agents: 0,
    commandNames: [],
    hooks: [],
    mcpServers: [],
    loadable: true,
    unloadableReason: null,
    fingerprint: 'p1',
    scan: { status: 'clean', findings: [], agentReview: 'off' },
    enabled: false,
    changed: false,
    ...overrides,
  };
}

interface Calls {
  enable: unknown[];
  plugins: unknown[];
}

function serve(plugins: UserPlugin[]): Calls {
  const calls: Calls = { enable: [], plugins: [] };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/conversations/${CHAT}/mcp`)) {
        return json({ servers: [docs, repoServer] });
      }
      if (url.endsWith(`/mcp/servers/${SERVER_ID}/enable`)) {
        calls.enable.push(JSON.parse(String(init?.body)));
        return json({ servers: [] });
      }
      if (url.endsWith('/user-plugins') && !init?.method) return json({ plugins });
      if (url.includes('/user-plugins/')) {
        calls.plugins.push(JSON.parse(String(init?.body)));
        return json({ plugins });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

function show(showPlugins = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RailTools conversationId={CHAT} repos={[]} showPlugins={showPlugins} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  opened.sections.length = 0;
  opened.focus.length = 0;
});

describe('tools in the context rail', () => {
  it('turns an MCP server on for this chat only and leaves repo servers read only', async () => {
    const calls = serve([]);
    show();
    fireEvent.click(await screen.findByRole('switch', { name: 'Use docs in this chat' }));
    await waitFor(() => expect(calls.enable).toHaveLength(1));
    expect(calls.enable[0]).toEqual({
      scope: 'chat',
      scopeId: CHAT,
      enabled: true,
      fingerprint: 'f1',
    });
    expect(screen.getByText('shop-db')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /shop-db/ })).toBeNull();
  });

  it('switches a checked plugin for all Claude chats and sends one with findings to Settings', async () => {
    const calls = serve([
      plugin({}),
      plugin({
        key: 'risky@market',
        name: 'risky',
        scan: { status: 'review', findings: [], agentReview: 'off' },
      }),
    ]);
    show();
    expect(await screen.findAllByText('2 skills')).toHaveLength(2);

    fireEvent.click(screen.getByRole('switch', { name: 'Use notes in all Claude chats' }));
    await waitFor(() => expect(calls.plugins).toHaveLength(1));
    expect(calls.plugins[0]).toMatchObject({ enabled: true, fingerprint: 'p1' });

    fireEvent.click(screen.getByRole('switch', { name: 'Use risky in all Claude chats' }));
    expect(opened.sections).toEqual(['chats']);
    expect(opened.focus).toEqual(['Claude plugins']);
    expect(calls.plugins).toHaveLength(1);
  });

  it('leaves plugins out when the chat is not a Claude chat', async () => {
    serve([plugin({})]);
    show(false);
    await screen.findByRole('switch', { name: 'Use docs in this chat' });
    expect(screen.queryByText('Claude plugins')).toBeNull();
  });
});
