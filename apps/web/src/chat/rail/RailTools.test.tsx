// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMcpServer } from '@spark-outpost/contracts';
import { RailTools } from './RailTools.tsx';

const CHAT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b301';

function server(name: string, id: string, enabled: boolean): ChatMcpServer {
  return {
    kind: 'user',
    id,
    name,
    source: 'user',
    transport: 'stdio',
    fingerprint: `${name}-f`,
    enabled,
    via: 'global',
    changed: false,
    check: null,
  };
}

const SERVERS = [
  server('github', '11111111-1111-4111-8111-111111111111', true),
  server('postgres', '22222222-2222-4222-8222-222222222222', false),
];

function serve() {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/conversations/${CHAT}/mcp`)) return json({ servers: SERVERS });
      if (url.endsWith('/agent-connectors')) return json({ connectors: [] });
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RailTools conversationId={CHAT} repos={[]} provider="codex" />
    </QueryClientProvider>,
  );
}

const group = () => screen.findByRole('button', { name: /^MCP servers/ });

beforeEach(() => {
  localStorage.clear();
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Tools section of the context rail', () => {
  it('shows each group as one closed line with a count', async () => {
    show();
    const mcp = await group();
    expect(mcp.getAttribute('aria-expanded')).toBe('false');
    expect(await screen.findByText('1 of 2 on')).toBeTruthy();
    const body = document.getElementById(mcp.getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    expect(screen.queryByRole('switch', { name: 'Use github in this chat' })).toBeNull();
  });

  it('opens a group in place and remembers it for the next rail', async () => {
    show();
    fireEvent.click(await group());
    expect((await group()).getAttribute('aria-expanded')).toBe('true');
    const github = screen.getByRole('switch', { name: 'Use github in this chat' });
    expect(github.getAttribute('aria-describedby')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('spark-outpost.chat-rail.tools-open')!)).toEqual([
      'mcp',
    ]);

    cleanup();
    show();
    expect((await group()).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(await group());
    expect((await group()).getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('spark-outpost.chat-rail.tools-open')).toBe('[]');
  });

  it('starts closed when the remembered value is unreadable', async () => {
    localStorage.setItem('spark-outpost.chat-rail.tools-open', '{not json');
    show();
    expect((await group()).getAttribute('aria-expanded')).toBe('false');
  });
});
