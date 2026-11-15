// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onPaneUrl, takePaneUrl } from '../../browser/pending-pane-url.ts';
import { RailPorts } from './RailPorts.tsx';

const CHAT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b301';
const OTHER = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b302';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(ports: Record<string, number[]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const found = String(input).endsWith('/api/chat-ports');
      return new Response(JSON.stringify(found ? { ports } : {}), {
        status: found ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RailPorts chatId={CHAT} />
    </QueryClientProvider>,
  );
}

describe('ports in the context rail', () => {
  it("lists only this chat's ports and opens one in its Browser pane", async () => {
    serve({ [CHAT]: [3000, 5173], [OTHER]: [8080] });
    const opened = vi.fn();
    const stop = onPaneUrl(opened);
    show();

    const port = await screen.findByRole('button', {
      name: 'Open localhost:5173 in the Browser pane',
    });
    expect(port.textContent).toBe('localhost:5173');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /8080/ })).toBeNull();

    fireEvent.click(port);
    expect(opened).toHaveBeenCalled();
    expect(takePaneUrl(CHAT)).toBe('http://localhost:5173/');
    stop();
  });

  it('shows nothing when the chat listens on no port', async () => {
    serve({ [OTHER]: [8080] });
    show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('list', { name: 'Listening ports' })).toBeNull();
  });
});
