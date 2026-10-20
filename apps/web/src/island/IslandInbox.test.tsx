// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, ConversationDetail } from '@spark-outpost/contracts';
import { api } from '../api/client.ts';
import { approvalsApi } from '../api/approvals.ts';
import { at, event, link } from '../calendar/test-fixtures.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { homeApi } from '../home/home-api.ts';
import { ARMING_MS } from './island-parts.tsx';
import { IslandInbox, type InboxBundle } from './IslandInbox.tsx';
import { card, chat, CHAT_B, run } from './inbox-test-fixtures.ts';

const standup = event('Standup', at(10, 8), at(10, 23), { link: link('zoom') });

function calendar(overrides: Partial<IslandCalendar> = {}): IslandCalendar {
  return {
    connected: true,
    line: null,
    hold: { held: false, onHeld: () => undefined },
    at: at(10, 0),
    upcoming: [standup],
    clashes: new Map(),
    choosing: null,
    calendarName: () => 'Spark Work',
    hopKeys: [],
    onOpenEvent: vi.fn(),
    onChoose: vi.fn(),
    onCapture: vi.fn(),
    onDismiss: vi.fn(),
    onSnooze: vi.fn(),
    onDismissNudge: vi.fn(),
    countdown: null,
    onCancelJoin: vi.fn(),
    onJoinNow: vi.fn(),
    onJoined: vi.fn(),
    ...overrides,
  };
}

const finished = chat(CHAT_B, {
  title: 'CP-49259 POC',
  unread: true,
  latestRun: run('succeeded', { finishedAt: '2026-10-20T09:59:00.000Z' }),
});

function inbox(overrides: Partial<InboxBundle> = {}): InboxBundle {
  const asking = card('approval');
  return {
    chats: [asking.chat, finished],
    cards: [asking],
    aside: [],
    details: new Map<string, ConversationDetail>(),
    onLater: vi.fn(),
    onReview: vi.fn(),
    onDecided: vi.fn(),
    onConnectors: null,
    ...overrides,
  };
}

function show(bundle: InboxBundle, cal: IslandCalendar) {
  const onOpenChat = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IslandInbox
        inbox={bundle}
        calendar={cal}
        now={Date.parse('2026-10-20T10:00:00Z')}
        onOpenChat={onOpenChat}
      />
    </QueryClientProvider>,
  );
  return onOpenChat;
}

let decide: ReturnType<typeof vi.spyOn>;
let seen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(10, 0));
  vi.spyOn(homeApi, 'health').mockResolvedValue({ githubSignInNeeded: false } as never);
  decide = vi.spyOn(approvalsApi, 'decide').mockResolvedValue({} as never);
  seen = vi.spyOn(api, 'markConversationSeen').mockResolvedValue(null);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function armed() {
  await act(async () => {
    vi.advanceTimersByTime(ARMING_MS + 10);
  });
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
}

describe('the island inbox', () => {
  it('answers, sets aside, joins, dismisses and clears in place, never opening Spark', async () => {
    const bundle = inbox();
    const cal = calendar();
    const onOpenChat = show(bundle, cal);
    await armed();
    fireEvent.click(screen.getByRole('button', { name: /^Allow/ }));
    await flush();
    expect(decide).toHaveBeenCalledWith(bundle.cards[0]!.approval!.id, {
      optionId: 'yes',
      scope: 'once',
      payloadHash: 'sha256:abc',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(bundle.onLater).toHaveBeenCalledWith(bundle.cards[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Join Zoom: Standup' }));
    expect(window.open).toHaveBeenCalledWith(standup.link!.url, '_blank', 'noopener,noreferrer');
    expect(cal.onJoined).toHaveBeenCalledWith(standup.key);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the alert for Standup' }));
    expect(cal.onDismissNudge).toHaveBeenCalledWith(standup as CalendarEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Clear CP-49259 POC' }));
    expect(seen).toHaveBeenCalledWith(CHAT_B);
    expect(screen.queryByRole('button', { name: 'Clear CP-49259 POC' })).toBeNull();
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(cal.onOpenEvent).not.toHaveBeenCalled();
  });

  it('answers the top card with Y and N, but not while typing or on a held key', async () => {
    const bundle = inbox();
    show(bundle, calendar());
    await armed();
    fireEvent.keyDown(window, { key: 'y', repeat: true });
    await flush();
    expect(decide).not.toHaveBeenCalled();
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.keyDown(input, { key: 'n' });
    await flush();
    expect(decide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'n' });
    await flush();
    expect(decide).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ optionId: 'no' }),
    );
    input.remove();
  });

  it('opens Spark on the chat only from a row, Answer in Spark or the meeting itself', async () => {
    const open = card('open', { chat: chat(CHAT_B, { needsInput: true, title: 'pipeline-poc' }) });
    const bundle = inbox({ cards: [open] });
    const cal = calendar();
    const onOpenChat = show(bundle, cal);
    fireEvent.click(screen.getByRole('button', { name: /Answer in Spark/ }));
    expect(onOpenChat).toHaveBeenLastCalledWith(CHAT_B);
    fireEvent.click(screen.getByRole('button', { name: /^CP-49259 POC/ }));
    expect(onOpenChat).toHaveBeenLastCalledWith(CHAT_B);
    fireEvent.click(screen.getByRole('button', { name: /^Standup/ }));
    expect(cal.onOpenEvent).toHaveBeenCalledWith(standup.key);
  });

  it('says so when nothing needs you', () => {
    show(inbox({ cards: [], chats: [] }), calendar({ upcoming: [] }));
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
  });
});
