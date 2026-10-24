// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { SoloTurn } from '../SoloTurn.tsx';
import { buildTurns } from '../turns.ts';

const CHAT = '00000000-0000-4000-8000-000000000002';
const TURN = '00000000-0000-4000-8000-000000000001';
const ASKED = '00000000-0000-4000-8000-000000000003';
const WORK = 'Changed the parser. Tests pass.';
const PUBLISHED = 'Pushed spark/fix and opened pull request #4.';

class QuietEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', QuietEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reply(id: string, content: string, createdAt: string): Message {
  return {
    id,
    conversationId: CHAT,
    role: 'assistant',
    runId: TURN,
    content,
    createdAt,
    attachments: [],
  };
}

function show(messages: Message[]) {
  const run = {
    id: TURN,
    conversationId: CHAT,
    userMessageId: ASKED,
    parentRunId: null,
    status: 'succeeded',
    mode: 'do',
    provider: 'claude',
    snapshot: null,
    revertedAt: null,
    error: null,
    createdAt: '2026-10-10T10:00:00.000Z',
  } as unknown as Run;
  const detail = {
    conversation: { id: CHAT },
    messages,
    runs: [run],
    activity: {},
    tasks: [],
    approvals: [],
    commands: [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        runId: TURN,
        command: 'git push origin spark/fix',
        cwd: null,
        live: false,
        startedAt: '2026-10-10T10:00:09.000Z',
        finishedAt: '2026-10-10T10:00:10.000Z',
        status: 'completed',
        exitCode: 0,
        outputChars: 0,
        textOffset: 0,
        textBefore: null,
        textHeld: null,
      },
    ],
  } as unknown as ConversationDetail;
  const [turn] = buildTurns(detail);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SoloTurn
        run={run}
        detail={detail}
        assistantMessage={turn!.assistantMessage}
        laterMessages={turn!.laterMessages}
        repo={null}
      />
    </QueryClientProvider>,
  );
}

describe('a turn that ended with a publish step', () => {
  const messages = [
    reply('m1', WORK, '2026-10-10T10:00:05.000Z'),
    reply('m2', PUBLISHED, '2026-10-10T10:00:12.000Z'),
  ];

  it('shows the work reply, then the publish result, in one turn with no agent header', () => {
    const view = show(messages);
    const text = view.container.textContent ?? '';
    expect(text).toContain(WORK);
    expect(text.indexOf(WORK)).toBeLessThan(text.indexOf(PUBLISHED));
    expect(view.container.querySelectorAll('.msg.ai')).toHaveLength(1);
    expect(view.container.querySelector('.ai-head')).toBeNull();
  });

  it('keeps the publish reply and its push command in the publish result', () => {
    show(messages);
    const result = screen.getByRole('group', { name: 'Publish result' });
    expect(result.textContent).toContain(PUBLISHED);
    expect(result.textContent).toContain('Ran git push…');
    expect(screen.getByRole('region', { name: 'Command: git push origin spark/fix' })).toBeTruthy();
    expect(result.textContent).not.toContain(WORK);
  });

  it('shows no publish result for a turn with one reply', () => {
    show([messages[0]!]);
    expect(screen.queryByRole('group', { name: 'Publish result' })).toBeNull();
    expect(within(document.body).getByText(WORK)).toBeTruthy();
  });
});
