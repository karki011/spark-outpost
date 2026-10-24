// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandView } from '../commands/command-model.ts';
import type { StepView } from '../run-projection.ts';
import type { RowContext } from './Rows.tsx';
import { TurnRows } from './TurnRows.tsx';
import { turnRowParts } from './turn-rows.ts';

afterEach(cleanup);

function command(
  id: string,
  status: CommandView['status'],
  at: number,
  extra: Partial<CommandView> = {},
): CommandView {
  return {
    ...extra,
    id,
    runId: 'run',
    command: `pnpm ${id}`,
    cwd: null,
    live: true,
    startedAt: new Date(1_000 + at).toISOString(),
    textOffset: null,
    textBefore: null,
    textHeld: null,
    status,
    exitCode: status === 'completed' ? 0 : status === 'failed' ? 1 : null,
    finishedAt: status === 'running' ? null : new Date(2_000 + at).toISOString(),
    outputChars: 0,
    output: '',
    received: 0,
    appended: 0,
    epoch: 0,
  };
}

const context: RowContext = {
  runId: 'run',
  working: true,
  waiting: false,
  changes: null,
  todo: null,
  answers: new Map([
    ['call-test', { line: 'You allowed it once · 16:58', denied: false }],
    ['call-rm', { line: 'You denied it · 16:59', denied: true }],
  ]),
};
const client = new QueryClient();

function Turn({ commands, steps = [] }: { commands: CommandView[]; steps?: StepView[] }) {
  const parts = turnRowParts({ text: '', steps, commands });
  return (
    <QueryClientProvider client={client}>
      <TurnRows parts={parts} context={context}>
        {(text) => <p>{text}</p>}
      </TurnRows>
    </QueryClientProvider>
  );
}

const toggle = (name: RegExp) => screen.getByRole('button', { name });

describe('command rows', () => {
  it('keeps an opened command open and focused when a sibling finishes and they group', () => {
    const view = render(
      <Turn commands={[command('lint', 'completed', 0), command('test', 'running', 10)]} />,
    );
    fireEvent.focus(toggle(/pnpm lint/));
    toggle(/pnpm lint/).focus();
    fireEvent.click(toggle(/pnpm lint/));
    expect(toggle(/pnpm lint/).getAttribute('aria-expanded')).toBe('true');

    view.rerender(
      <Turn commands={[command('lint', 'completed', 0), command('test', 'completed', 10)]} />,
    );
    expect(toggle(/Ran 2 commands/).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(/pnpm lint/).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle(/pnpm lint/));
  });

  it('counts interrupted commands in a group and opens it', () => {
    render(
      <Turn commands={[command('lint', 'interrupted', 0), command('test', 'interrupted', 10)]} />,
    );
    const group = toggle(/Ran 2 commands/);
    expect(group.textContent).toContain('2 interrupted');
    expect(group.getAttribute('aria-expanded')).toBe('true');
  });

  it("titles a command by the agent's description and shows the command and answer inside", () => {
    const described = { description: 'Run the tests', toolCallId: 'call-test' };
    render(<Turn commands={[command('test', 'completed', 0, described)]} />);
    const row = toggle(/Run the tests/);
    expect(row.textContent).not.toContain('pnpm test');
    expect(screen.queryByText('You allowed it once · 16:58')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('pnpm test').closest('pre')?.textContent).toBe('$ pnpm test');
    expect(screen.getByText('You allowed it once · 16:58')).toBeTruthy();
  });

  it('opens a group with a failed command and puts the failure first', () => {
    const thought = { name: 'Thinking', status: 'done' as const, reasoningId: 'r1' };
    render(
      <Turn
        steps={[thought]}
        commands={[command('lint', 'failed', 0), command('test', 'completed', 10)]}
      />,
    );
    const group = toggle(/Ran 2 commands, thought once/);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(group.querySelector('.trow-end')?.textContent).toMatch(/^1 failed·1 passed/);
    expect(toggle(/pnpm lint/).getAttribute('aria-expanded')).toBe('true');
  });

  it('heads a live group with the running step and keeps it in the card', () => {
    render(
      <Turn
        commands={[
          command('lint', 'completed', 0),
          command('test', 'completed', 10),
          command('build', 'running', 20),
        ]}
      />,
    );
    const head = toggle(/^In progressRunning pnpm build\d/);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /pnpm lint/ })).toBeNull();
    fireEvent.click(head);
    expect(toggle(/^Ran pnpm lint/)).toBeTruthy();
    expect(toggle(/^Running pnpm build/).closest('.trow-card')).toBeTruthy();
  });

  it('keeps an opened thought open when it finishes and joins the group', () => {
    const reads: StepView[] = [
      { name: 'Read `a.ts`', status: 'done' },
      { name: 'Read `b.ts`', status: 'done' },
    ];
    const thinking: StepView = {
      name: 'Thinking',
      status: 'open',
      reasoningId: 'r1',
      thought: 'Weighing it',
    };
    const view = render(<Turn commands={[]} steps={[...reads, thinking]} />);
    fireEvent.click(toggle(/^In progressThinking/));
    const thought = screen
      .getAllByRole('button', { name: /^Thinking/ })
      .find((button) => button.closest('.trow-card'))!;
    fireEvent.click(thought);
    expect(thought.getAttribute('aria-expanded')).toBe('true');

    view.rerender(<Turn commands={[]} steps={[...reads, { ...thinking, status: 'done' }]} />);
    expect(toggle(/^Read 2 files, thought once/).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(/^Thought/).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(/^Thought/)).toBe(thought);
  });

  it('says a command was denied, in the step and in its group', () => {
    render(
      <Turn
        commands={[
          command('rm', 'failed', 0, { toolCallId: 'call-rm' }),
          command('test', 'completed', 10),
        ]}
      />,
    );
    const group = toggle(/Ran 2 commands/);
    expect(group.querySelector('.trow-end')?.textContent).toMatch(/^1 denied·1 passed/);
    const denied = toggle(/pnpm rm/);
    expect(denied.textContent).toContain('denied');
    expect(denied.textContent).not.toContain('failed');
    if (denied.getAttribute('aria-expanded') !== 'true') fireEvent.click(denied);
    expect(screen.getByText('You denied it · 16:59')).toBeTruthy();
  });
});
