// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { CheckpointCard } from '../checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { DockContext } from './dock-context.ts';
import { PendingDock } from './PendingDock.tsx';
import { usePendingDock } from './use-pending-dock.ts';

afterEach(cleanup);

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

const command: Approval = {
  id: '00000000-0000-4000-8000-0000000000d2',
  runId: '00000000-0000-4000-8000-000000000001',
  toolCallId: 'call_1',
  kind: 'execute',
  title: 'pnpm test',
  payload: { command: 'pnpm test', cwd: '/work', paths: [], diffs: [], truncated: false },
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

function Card({ approval }: { approval: Approval }) {
  return isCheckpoint(approval) ? (
    <CheckpointCard approval={approval} />
  ) : (
    <ApprovalCard approval={approval} provider="claude" repo={null} />
  );
}

function Chat({ approvals }: { approvals: Approval[] }) {
  const dock = usePendingDock();
  return (
    <DockContext value={dock.api}>
      <div data-testid="thread">
        {approvals.map((approval) => (
          <Card key={approval.id} approval={approval} />
        ))}
      </div>
      <PendingDock dock={dock} />
      <div className="composer">
        <textarea aria-label="Message" />
      </div>
    </DockContext>
  );
}

function show(approvals: Approval[]) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Chat approvals={approvals} />
    </QueryClientProvider>,
  );
  return {
    rerender: (next: Approval[]) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <Chat approvals={next} />
        </QueryClientProvider>,
      ),
  };
}

const dock = () => screen.getByRole('region', { name: 'Waiting for you' });
const thread = () => screen.getByTestId('thread');

describe('pending dock', () => {
  it('docks a waiting card above the composer and leaves a line in the thread', () => {
    show([questions]);
    const card = within(dock()).getByRole('group', { name: /Spark has a few questions/ });
    expect(within(card).getByText('Which report?')).toBeTruthy();
    expect(within(thread()).queryByRole('group')).toBeNull();
    expect(within(thread()).getByText('Spark has a few questions')).toBeTruthy();
    expect(within(thread()).getByRole('button', { name: 'Waiting for your answer' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Waiting for you above the message box: Spark has a few questions',
    );
  });

  it('does not take focus from the composer when a card docks', () => {
    const view = show([]);
    const message = screen.getByRole('textbox', { name: 'Message' });
    message.focus();
    view.rerender([questions]);
    expect(document.activeElement).toBe(message);
  });

  it('puts the resolved card back in its place in the thread', () => {
    const view = show([questions]);
    view.rerender([
      {
        ...questions,
        status: 'allowed',
        decidedBy: 'auto',
        decisionOptionId: CHECKPOINT_OPTION.useDefaults,
        autoContinueAt: '2026-09-26T10:00:10.000Z',
      },
    ]);
    const card = within(thread()).getByRole('group', { name: /Spark has a few questions/ });
    expect(card.textContent).toContain('Went with the best guesses after 10s.');
    expect(within(thread()).queryByRole('button', { name: 'Waiting for your answer' })).toBeNull();
    expect(document.querySelectorAll('[data-dock-slot] .appr')).toHaveLength(0);
  });

  it('shows several waiting cards one at a time, oldest first', () => {
    show([command, questions]);
    expect(within(dock()).getByText('1 of 2')).toBeTruthy();
    const visible = () => [...dock().querySelectorAll('.dock-slot:not([hidden]) > .appr')];
    expect(visible()).toHaveLength(1);
    expect(visible()[0]!.textContent).toContain('Spark has a few questions');
    fireEvent.click(within(dock()).getByRole('button', { name: 'Next waiting card' }));
    expect(within(dock()).getByText('2 of 2')).toBeTruthy();
    expect(visible()[0]!.textContent).toContain('Run a command?');
    expect(
      within(thread()).getAllByRole('button', { name: 'Waiting for your answer' }),
    ).toHaveLength(2);
  });

  it('jumps from the thread line to the docked card', async () => {
    show([command, questions]);
    const lines = within(thread()).getAllByRole('button', { name: 'Waiting for your answer' });
    await act(async () => {
      fireEvent.click(lines[0]!);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(within(dock()).getByText('2 of 2')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Yes');
  });
});

describe('clarify questions', () => {
  it('lists each question with its best guess and quick answers', () => {
    show([questions]);
    const card = within(dock()).getByRole('group', { name: /Spark has a few questions/ });
    expect(card.textContent).toContain('Best guess: Spend');
    const send = within(card).getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const usage = within(card).getByRole('button', { name: 'Usage' });
    fireEvent.click(usage);
    expect(usage.getAttribute('aria-pressed')).toBe('true');
    expect(
      (within(card).getByRole('textbox', { name: 'Which report?' }) as HTMLInputElement).value,
    ).toBe('Usage');
    expect(send.disabled).toBe(false);
    expect(within(card).getByRole('button', { name: 'Go with my best guesses' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
});
