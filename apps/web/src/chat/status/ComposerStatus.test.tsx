// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_OPTION, type Approval, type Run } from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { CheckpointCard } from '../checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { ComposerStatus } from './ComposerStatus.tsx';
import { StatusContext } from './status-context.ts';
import { createStatusStore, type StatusStore } from './status-store.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

const questions = checkpoint(
  {
    kind: 'clarify',
    question: 'A few questions first',
    agent: 'Pip',
    questions: [
      { question: 'Which report?', options: ['Spend', 'Usage'], default: 'Spend' },
      { question: 'Which period?', options: [], default: 'This month' },
    ],
    autoOption: CHECKPOINT_OPTION.useDefaults,
  },
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    createdAt: '2026-09-26T10:00:00.000Z',
    options: [
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      {
        optionId: CHECKPOINT_OPTION.useDefaults,
        name: 'Go with my best guesses',
        kind: 'allow_once',
      },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  },
);

const GREP = "git grep -l -i 'AI_USER' -- apps/web/src packages/contracts/src";

const command: Approval = {
  id: '00000000-0000-4000-8000-0000000000d2',
  runId: '00000000-0000-4000-8000-000000000001',
  toolCallId: 'call_1',
  kind: 'execute',
  title: GREP,
  payload: { command: GREP, cwd: '/work', paths: [], diffs: [], truncated: false },
  payloadHash: 'sha256:abc',
  options: [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
  ],
  status: 'pending',
  reason: 'Commands always ask',
  decisionOptionId: null,
  scope: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-26T10:01:00.000Z',
};

const RUN_ID = '00000000-0000-4000-8000-000000000001';

function run(status: Run['status']): Run {
  return {
    id: RUN_ID,
    status,
    startedAt: '2026-09-26T10:00:00.000Z',
    finishedAt: status === 'succeeded' ? '2026-09-26T10:02:14.000Z' : null,
  } as Run;
}

function Card({ approval }: { approval: Approval }) {
  return isCheckpoint(approval) ? (
    <CheckpointCard approval={approval} />
  ) : (
    <ApprovalCard approval={approval} provider="claude" repo={null} />
  );
}

interface ChatProps {
  store: StatusStore;
  approvals: Approval[];
  runs?: Run[];
  active?: string | null;
}

function Chat({ store, approvals, runs = [], active = null }: ChatProps) {
  return (
    <StatusContext value={store}>
      <div data-testid="thread">
        {approvals.map((approval) => (
          <Card key={approval.id} approval={approval} />
        ))}
      </div>
      <ComposerStatus store={store} runs={runs} activeRunId={active} provider="claude" />
      <div className="composer">
        <textarea aria-label="Message" />
      </div>
    </StatusContext>
  );
}

function show(props: Omit<ChatProps, 'store'>) {
  const client = new QueryClient();
  const store = createStatusStore();
  const view = render(
    <QueryClientProvider client={client}>
      <Chat store={store} {...props} />
    </QueryClientProvider>,
  );
  return {
    store,
    rerender: (next: Omit<ChatProps, 'store'>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <Chat store={store} {...next} />
        </QueryClientProvider>,
      ),
  };
}

const status = () => document.querySelector('.cstatus') as HTMLElement;
const thread = () => screen.getByTestId('thread');
const frames = () =>
  act(async () => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });

describe('waiting for you', () => {
  it('sums up one waiting approval in one line and keeps the card in the thread', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    show({ approvals: [command] });
    const line = within(status()).getByRole('button', { name: /^Waiting for you/ });
    expect(line.textContent).toBe("Waiting for you · approve git grep -l -i 'AI_USER' … Review");
    expect(line.querySelector('code')?.textContent).toBe("git grep -l -i 'AI_USER' …");
    expect(within(thread()).getByRole('group', { name: /Run a command\?/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(within(status()).getByRole('status').textContent).toBe(
      "Waiting for you: approve git grep -l -i 'AI_USER' …",
    );
  });

  it('shows the full command on hover', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    show({ approvals: [command] });
    const line = within(status()).getByRole('button', { name: /^Waiting for you/ });
    fireEvent.pointerEnter(line, { pointerType: 'mouse' });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole('tooltip').textContent).toContain(GREP);
  });

  it('jumps to the card and focuses its first answer', async () => {
    show({ approvals: [questions, command] });
    fireEvent.click(within(status()).getByRole('button', { name: /^Waiting for you 2 things/ }));
    const list = within(status()).getByRole('list', { name: 'Waiting for you' });
    const items = within(list).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      'questions: Which report? +1',
      "approve git grep -l -i 'AI_USER' …",
    ]);
    fireEvent.click(items[1]!);
    await frames();
    expect(document.activeElement?.textContent).toBe('Yes');
    expect(within(status()).queryByRole('list')).toBeNull();
  });

  it('jumps to the oldest waiting card from the keyboard', async () => {
    show({ approvals: [command] });
    screen.getByRole('textbox', { name: 'Message' }).focus();
    fireEvent.keyDown(window, { key: 'Y', shiftKey: true, ctrlKey: true, metaKey: true });
    await frames();
    expect(document.activeElement?.textContent).toBe('Yes');
  });

  it('does not take focus from the composer when a card arrives', () => {
    const view = show({ approvals: [] });
    const message = screen.getByRole('textbox', { name: 'Message' });
    message.focus();
    view.rerender({ approvals: [questions] });
    expect(document.activeElement).toBe(message);
    expect(status().textContent).toContain('questions: Which report? +1');
  });

  it('clears the line once the card is answered', () => {
    const view = show({ approvals: [questions] });
    view.rerender({
      approvals: [
        {
          ...questions,
          status: 'allowed',
          decidedBy: 'auto',
          decisionOptionId: CHECKPOINT_OPTION.useDefaults,
          autoContinueAt: '2026-09-26T10:00:10.000Z',
        },
      ],
    });
    const card = within(thread()).getByRole('group', { name: /Pip has questions/ });
    expect(card.textContent).toContain('Went with the best guesses after 10s.');
    expect(status().dataset.state).toBe('idle');
  });
});

const CLAUDE = { id: 'r', name: 'Claude', provider: 'claude', kind: 'agent' } as const;
const BOLT = { id: 'b', name: 'Bolt', provider: 'claude', kind: 'crew' } as const;
const JEV = { id: 'lead', name: 'Jev', provider: 'jev', kind: 'lead' } as const;
const shown = () => status().querySelector('.cs-wrap')?.textContent;

describe('while the agent works', () => {
  it('updates one line in place with who works and on what', () => {
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    expect(shown()).toBe('Claude is thinking…');
    act(() => view.store.report({ ...CLAUDE, working: true, step: 'Thinking' }));
    expect(shown()).toBe('Claude is thinking…');
    act(() => view.store.report({ ...CLAUDE, working: true, step: `\`${GREP}\`` }));
    expect(shown()).toBe("Claude is working · Running git grep -l -i 'AI_USER' -- apps/web/src …");
    act(() => view.store.report({ ...CLAUDE, working: true, step: 'Edit `table.tsx`' }));
    expect(shown()).toBe('Claude is working · Editing table.tsx');
    expect(status().querySelectorAll('.cs-line')).toHaveLength(1);
  });

  it('leaves the status to the turn header while it is in view, and still announces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    act(() =>
      view.store.report({ ...CLAUDE, id: RUN_ID, working: true, step: 'Edit `table.tsx`' }),
    );
    expect(shown()).toBe('Claude is working · Editing table.tsx');
    act(() => view.store.showHead(RUN_ID, true));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(status().dataset.state).toBe('idle');
    expect(screen.getByRole('status').textContent).toBe('Claude is working: Editing table.tsx');
    act(() => view.store.showHead(RUN_ID, false));
    expect(status().dataset.state).toBe('running');
  });

  it('hides only while the header of the crew member it names is in view', () => {
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    act(() => view.store.report({ ...JEV, working: true, step: null }));
    act(() => view.store.report({ ...BOLT, working: true, step: 'Edit `table.tsx`' }));
    expect(shown()).toBe('Bolt is working · Editing table.tsx');
    act(() => view.store.showHead(JEV.id, true));
    expect(shown()).toBe('Bolt is working · Editing table.tsx');
    act(() => view.store.showHead(BOLT.id, true));
    expect(status().dataset.state).toBe('idle');
    act(() => view.store.report({ ...BOLT, working: false, step: null }));
    expect(status().dataset.state).toBe('idle');
    act(() => view.store.showHead(JEV.id, false));
    expect(shown()).toBe('Jev is choosing the next step…');
  });

  it('names the crew member at work, and the lead only while nobody else works', () => {
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    act(() => view.store.report({ ...JEV, working: true, step: null }));
    expect(shown()).toBe('Jev is choosing the next step…');
    act(() => view.store.report({ ...JEV, working: true, step: null, doing: 'checking P1' }));
    expect(shown()).toBe('Jev is checking P1…');
    act(() => view.store.report({ ...BOLT, working: true, step: null }));
    expect(shown()).toBe('Bolt is thinking…');
    act(() => view.store.report({ ...BOLT, working: true, step: 'Read `CLAUDE.md`' }));
    expect(shown()).toBe('Bolt is working · Reading CLAUDE.md');
    act(() => view.store.report({ ...BOLT, working: false, step: null }));
    expect(shown()).toBe('Jev is checking P1…');
  });

  it('says the Coordinator is planning the pieces until it runs a step', () => {
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    const atlas = { ...BOLT, name: 'Atlas', doing: 'planning the pieces' };
    act(() => view.store.report({ ...atlas, working: true, step: null }));
    expect(shown()).toBe('Atlas is planning the pieces…');
    act(() => view.store.report({ ...atlas, working: true, step: 'Read `CLAUDE.md`' }));
    expect(shown()).toBe('Atlas is working · Reading CLAUDE.md');
  });

  it('adds the elapsed time once a step runs long', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    act(() => view.store.report({ ...CLAUDE, working: true, step: '`pnpm test`' }));
    expect(status().querySelector('.cs-time')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(status().querySelector('.cs-time')?.textContent).toBe('12s');
  });

  it('says Done with the run time, then goes quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    view.rerender({ approvals: [], runs: [run('succeeded')], active: null });
    expect(shown()).toBe('Done · 2m 14s');
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(status().dataset.state).toBe('idle');
  });

  it('announces politely, at most once every few seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const view = show({ approvals: [], runs: [run('running')], active: RUN_ID });
    const said = () => within(status()).getByRole('status').textContent;
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(said()).toBe('Claude is thinking…');
    for (const file of ['a.ts', 'b.ts', 'c.ts']) {
      act(() => view.store.report({ ...CLAUDE, working: true, step: `Read \`${file}\`` }));
      await act(() => vi.advanceTimersByTimeAsync(500));
    }
    expect(said()).toBe('Claude is thinking…');
    expect(shown()).toContain('Reading c.ts');
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(said()).toBe('Claude is working: Reading c.ts');
  });
});

describe('clarify questions', () => {
  it('lists each question with its best guess and quick answers', () => {
    show({ approvals: [questions] });
    const card = within(thread()).getByRole('group', { name: /Pip has questions/ });
    expect(card.textContent).toContain('Spendbest guess');
    expect(card.textContent).toContain('Which period?Best guess: This month');
    const send = within(card).getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const usage = within(card).getByRole('button', { name: 'Usage' });
    fireEvent.click(usage);
    expect(usage.getAttribute('aria-pressed')).toBe('true');
    const spend = within(card).getByRole('button', { name: /^Spend/ });
    fireEvent.click(spend);
    expect(usage.getAttribute('aria-pressed')).toBe('true');
    expect(spend.getAttribute('aria-pressed')).toBe('true');
    expect(within(card).getByRole('group', { name: /question 1, choose any$/ })).toBeTruthy();
    expect(
      (within(card).getByRole('textbox', { name: 'Which report?' }) as HTMLTextAreaElement).value,
    ).toBe('');
    expect(send.disabled).toBe(false);
    fireEvent.click(usage);
    fireEvent.click(spend);
    expect(send.disabled).toBe(true);
    expect(within(card).getByRole('button', { name: 'Go with my best guesses' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
