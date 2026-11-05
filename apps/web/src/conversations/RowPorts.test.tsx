// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowPorts } from './RowPorts.tsx';

const CHAT = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b301';
const OTHER = '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b302';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(ports: Record<string, number[]>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/chat-ports')) {
      return new Response(JSON.stringify({ ports }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function show(onOpenPort = vi.fn(), parentClick = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <div onClick={parentClick}>
        <RowPorts chatId={CHAT} onOpenPort={onOpenPort} />
      </div>
    </QueryClientProvider>,
  );
  return { onOpenPort, parentClick };
}

describe('ports on a chat row', () => {
  it("shows only this chat's ports and opens one without opening the row", async () => {
    serve({ [CHAT]: [3000, 5173], [OTHER]: [8080] });
    const { onOpenPort, parentClick } = show();

    const chip = await screen.findByRole('button', {
      name: 'Open localhost:5173 in the Browser pane',
    });
    expect(chip.textContent).toBe(':5173');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /8080/ })).toBeNull();

    fireEvent.click(chip);
    expect(onOpenPort).toHaveBeenCalledWith(CHAT, 'http://localhost:5173/');
    expect(parentClick).not.toHaveBeenCalled();
  });
});
