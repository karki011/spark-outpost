// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRunSummary, ConversationDetail, Run } from '@spark-outpost/contracts';
import { SoloTurn } from '../SoloTurn.tsx';

const CHAT = '00000000-0000-4000-8000-000000000002';
const TURN = '00000000-0000-4000-8000-000000000001';
const TASK = '00000000-0000-4000-8000-000000000004';
const REVERT = 'Revert to before this run';

class QuietEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  close() {}
}

function answerWith(runs: ChangeRunSummary[]) {
  const summary = { version: 'v1', files: runs.length, added: 0, removed: 0, runs, top: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith(`/tasks/${TASK}/changes/summary`)
        ? Response.json(summary)
        : new Response('{}', { status: 404 }),
    ),
  );
}

beforeEach(() => vi.stubGlobal('EventSource', QuietEventSource));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show() {
  const run = {
    id: TURN,
    conversationId: CHAT,
    parentRunId: null,
    status: 'succeeded',
    mode: 'do',
    provider: 'claude',
    snapshot: { kind: 'git' },
    revertedAt: null,
    error: null,
    createdAt: '2026-10-10T10:00:00.000Z',
  } as unknown as Run;
  const detail = {
    conversation: { id: CHAT },
    messages: [],
    runs: [run],
    activity: {},
    tasks: [{ id: TASK, runIds: [TURN] }],
    approvals: [],
  } as unknown as ConversationDetail;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SoloTurn run={run} detail={detail} assistantMessage={null} laterMessages={[]} repo={null} />
    </QueryClientProvider>,
  );
}

describe('Revert on a finished turn with no kept record', () => {
  it('is not offered when the turn changed nothing', async () => {
    answerWith([]);
    const view = show();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: REVERT })).toBeNull();
    expect(view.container.textContent).not.toContain(REVERT);
  });

  it('is offered when the turn changed a file', async () => {
    answerWith([{ runId: TURN, files: 1, added: 3, removed: 0, revertedAt: null }]);
    show();
    expect(await screen.findByRole('button', { name: REVERT })).toBeTruthy();
  });
});
