// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationDetail, MemberMessage } from '@spark-outpost/contracts';
import { member, orchestration } from '../crew/test-orchestration.ts';
import { RUN_ID, run } from '../crew/test-run.ts';
import { TurnSection } from './TurnSection.tsx';

const SPARK_RUN = '00000000-0000-4000-8000-0000000000b1';
const STEER_TEXT = 'Also check the rounding';

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

function steer(readBy: string): MemberMessage {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    runId: RUN_ID,
    body: STEER_TEXT,
    urgency: 'now',
    status: 'delivered',
    messageId: null,
    createdAt: '2026-10-10T10:00:20.000Z',
    deliveredAt: '2026-10-10T10:00:21.000Z',
    deliveredRunId: readBy,
  };
}

function turnDetail(only: boolean, readBy: string): ConversationDetail {
  const turn = run();
  return {
    conversation: { id: turn.conversationId, latestRun: null },
    runs: [turn],
    messages: [],
    memberMessages: [steer(readBy)],
    orchestrations: {
      [RUN_ID]: orchestration({
        depth: 'direct',
        depthSource: 'user',
        status: 'succeeded',
        crew: [
          member({
            runId: SPARK_RUN,
            role: 'spark',
            name: 'Quill',
            spark: { id: '00000000-0000-4000-8000-0000000000b2', role: 'Reviewer', only },
          }),
        ],
      }),
    },
    approvals: [],
    activity: {},
    commands: [],
    tasks: [],
    compactions: [],
    railFlags: [],
  } as unknown as ConversationDetail;
}

function shownSteers(only: boolean, readBy: string) {
  const detail = turnDetail(only, readBy);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TurnSection
        run={detail.runs[0]!}
        userMessage={null}
        assistantMessage={null}
        laterMessages={[]}
        previous={null}
        detail={detail}
        repo={null}
        onOpenChat={() => undefined}
      />
    </QueryClientProvider>,
  );
  return [...view.container.querySelectorAll('.msg.me.steered')].map((element) => ({
    inSpark: element.closest('[data-agent]')?.getAttribute('data-agent') === SPARK_RUN,
    text: element.textContent ?? '',
  }));
}

describe('a message sent while a Spark job runs', () => {
  it('shows once, inside the Spark that read it, when the main agent also runs', () => {
    const steers = shownSteers(false, SPARK_RUN);
    expect(steers).toHaveLength(1);
    expect(steers[0]).toMatchObject({ inSpark: true });
    expect(steers[0]!.text).toContain(STEER_TEXT);
  });

  it('shows once, inside the Spark that read it, when only the Spark runs', () => {
    expect(shownSteers(true, SPARK_RUN)).toEqual([expect.objectContaining({ inSpark: true })]);
  });

  it('stays with the main agent when the main agent read it', () => {
    expect(shownSteers(false, RUN_ID)).toEqual([expect.objectContaining({ inSpark: false })]);
  });
});
