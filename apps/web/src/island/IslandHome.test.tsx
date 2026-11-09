// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKPOINT_OPTION,
  formQuestions,
  type AgentForm,
  type ConversationDetail,
} from '@spark-outpost/contracts';
import { checkpoint } from '../crew/test-orchestration.ts';
import { approvalsApi } from '../api/approvals.ts';
import { at, event, link } from '../calendar/test-fixtures.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { homeApi } from '../home/home-api.ts';
import { ARMING_MS } from './island-parts.tsx';
import { IslandHome, type HomeBundle } from './IslandHome.tsx';
import { cardHeading } from './CardView.tsx';
import { pendingCards } from './island-model.ts';
import { approval, card, chat, CHAT_B, run } from './inbox-test-fixtures.ts';

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
    onJoinAtStart: vi.fn(),
    onCancelJoinAtStart: vi.fn(),
    onSnoozeAlert: vi.fn(),
    onDismissNudge: vi.fn(),
    countdown: null,
    joinLeadMs: 10 * 60_000,
    onCancelJoin: vi.fn(),
    onJoinNow: vi.fn(),
    onJoined: vi.fn(),
    ...overrides,
  };
}

const colour: AgentForm = {
  message: 'Which colour do you want?',
  fields: [
    {
      key: 'question_0',
      kind: 'one',
      question: 'Which colour do you want?',
      options: [
        { label: 'Red', value: 'Red' },
        { label: 'Blue', value: 'Blue' },
      ],
      required: false,
      noteKey: 'question_0_custom',
      otherValue: null,
      minimum: null,
      maximum: null,
      minLength: null,
      maxLength: null,
      minItems: null,
      maxItems: null,
      default: null,
    },
  ],
};

function agentQuestion() {
  const base = checkpoint(
    {
      kind: 'clarify',
      agent: 'Claude',
      question: 'Claude needs your input to continue',
      questions: formQuestions(colour),
    },
    {
      title: 'Which colour do you want?',
      options: [
        { optionId: CHECKPOINT_OPTION.answer, name: 'Send', kind: 'allow_once' },
        { optionId: CHECKPOINT_OPTION.finish, name: 'Skip', kind: 'reject_once' },
      ],
    },
  );
  return { ...base, payload: { ...base.payload, form: colour } };
}

const working = chat(CHAT_B, { title: 'Telemetry ingest', latestRun: run('running') });

function home(overrides: Partial<HomeBundle> = {}): HomeBundle {
  const asking = card('approval');
  return {
    chats: [asking.chat, working],
    cards: [asking],
    aside: [],
    seen: new Set(),
    details: new Map<string, ConversationDetail>(),
    projectNames: new Map(),
    ask: { conversationId: null, cards: [] },
    onLater: vi.fn(),
    onReview: vi.fn(),
    onDecided: vi.fn(),
    onConnectors: null,
    ...overrides,
  };
}

function show(bundle: HomeBundle, cal: IslandCalendar) {
  const onOpenChat = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IslandHome home={bundle} calendar={cal} now={at(10, 0)} onOpenChat={onOpenChat} />
    </QueryClientProvider>,
  );
  return onOpenChat;
}

let decide: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(10, 0));
  vi.spyOn(homeApi, 'health').mockResolvedValue({ githubSignInNeeded: false } as never);
  decide = vi.spyOn(approvalsApi, 'decide').mockResolvedValue({} as never);
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

describe('the island home', () => {
  it('shows one big card for the request, with the meeting riding along and working tiles', async () => {
    const bundle = home();
    const cal = calendar();
    const onOpenChat = show(bundle, cal);
    const focus = screen.getByRole('article', { name: 'orders-web-app needs you' });
    expect(focus.textContent).toContain('wants to run a command');
    expect(focus.textContent).toContain('gh workflow run cd-staging.yml');
    expect(screen.getByRole('region', { name: 'Next meeting' }).textContent).toContain(
      'Standup in 8 min',
    );
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
    fireEvent.click(screen.getByRole('button', { name: /^Telemetry ingest/ }));
    expect(onOpenChat).toHaveBeenLastCalledWith(CHAT_B);
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }));
    expect(onOpenChat).toHaveBeenLastCalledWith(bundle.cards[0]!.chat.id);
  });

  it('answers with Y and N, but not while typing or on a held key', async () => {
    show(home(), calendar());
    await armed();
    fireEvent.keyDown(window, { key: 'y', repeat: true });
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

  it('pages between requests and marks a read one as Seen', () => {
    const first = card('approval');
    const second = card('approval', {
      chat: chat(CHAT_B, { needsInput: true, title: 'Second chat' }),
      approval: approval({ id: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d' }),
    });
    show(home({ cards: [first, second], seen: new Set([second]) }), calendar({ upcoming: [] }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.queryByText('Seen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next request' }));
    expect(screen.getByRole('article', { name: 'Second chat needs you' })).toBeTruthy();
    expect(screen.getByText('Seen')).toBeTruthy();
  });

  it('gives the big card to a meeting at its start, with the request waiting below', () => {
    const cal = calendar({ at: at(10, 7, 30) });
    show(home(), cal);
    const meeting = screen.getByRole('article', { name: 'Meeting: Standup' });
    expect(meeting.textContent).toContain('in 1 min');
    expect(screen.getByRole('status').textContent).toContain('orders-web-app');
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 1 min' }));
    expect(cal.onSnoozeAlert).toHaveBeenCalledWith(standup);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(cal.onDismissNudge).toHaveBeenCalledWith(standup);
    fireEvent.click(screen.getByRole('button', { name: 'Show ›' }));
    expect(screen.getByRole('article', { name: 'orders-web-app needs you' })).toBeTruthy();
  });

  it("shows when a meeting set to join at start opens, with Don't open in its place", () => {
    const marked = { ...standup, joinAtStart: true };
    const cal = calendar({ at: at(10, 7, 30), upcoming: [marked] });
    show(home(), cal);
    const meeting = screen.getByRole('article', { name: 'Meeting: Standup' });
    expect(meeting.textContent).toMatch(/Opens at 10:08/);
    expect(screen.queryByRole('button', { name: /^Join at start/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Don't open Standup at 10:08/ }));
    expect(cal.onCancelJoinAtStart).toHaveBeenCalledWith(marked);
    expect(screen.getByRole('button', { name: 'Snooze 1 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('says nothing needs you and lists the meetings left today when all is clear', () => {
    show(home({ cards: [] }), calendar());
    expect(screen.getByRole('region', { name: 'Nothing needs you' }).textContent).toContain(
      '1 meeting left today',
    );
    expect(screen.getByRole('list', { name: 'Meetings left today' }).textContent).toContain(
      'Standup',
    );
  });

  it('heads a Spark action card with its own title', () => {
    const action = card('open', {
      approval: approval({
        kind: 'spark_action',
        title: 'Let the agent read your calendar?',
        payload: {
          command: null,
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
          sparkAction: { what: 'calendar_read', action: {} } as never,
        },
      }),
    });
    expect(cardHeading(action, 'Claude')).toBe('Let the agent read your calendar?');
  });

  it('sends an address to open to the chat, never answering it from the island', () => {
    const asking = chat(CHAT_B, { needsInput: true, title: 'Docs chat' });
    const open = approval({
      runId: asking.latestRun?.id ?? CHAT_B,
      kind: 'other',
      title: 'Open this address?',
      payload: {
        command: null,
        cwd: null,
        paths: [],
        diffs: [],
        truncated: false,
        openAddress: { url: 'https://auth.example.com/a', host: 'auth.example.com', message: '' },
      },
    });
    const [found] = pendingCards([asking], new Map([[CHAT_B, [open]]]));
    expect(found?.kind).toBe('open');
    expect(cardHeading(found!, 'Codex')).toBe('Codex wants you to open auth.example.com');
  });

  it('offers an agent question’s choices and sends the pick as the chat would', async () => {
    const asking = chat(CHAT_B, { needsInput: true, title: 'Colour chat' });
    const question = agentQuestion();
    const approvals = new Map([
      [CHAT_B, [{ ...question, runId: asking.latestRun?.id ?? question.runId }]],
    ]);
    const [found] = pendingCards([asking], approvals);
    expect(found?.kind).toBe('question');
    expect(cardHeading(found!, 'Claude')).toBe('Claude has a question');
    show(home({ chats: [asking], cards: [found!] }), calendar({ upcoming: [] }));
    await armed();
    expect(
      screen.getByText('Which colour do you want?', { selector: '.isl-focus-title' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    await flush();
    expect(decide).toHaveBeenCalledWith(question.id, {
      optionId: CHECKPOINT_OPTION.answer,
      scope: 'once',
      payloadHash: question.payloadHash,
      note: 'Which colour do you want? → Red',
      answers: [{ picks: ['Red'], text: '' }],
    });
  });
});
