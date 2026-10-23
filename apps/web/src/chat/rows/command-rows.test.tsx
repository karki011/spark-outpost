// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandView } from '../commands/command-model.ts';
import type { RowContext } from './Rows.tsx';
import { TurnRows } from './TurnRows.tsx';
import { turnRowParts } from './turn-rows.ts';

afterEach(cleanup);

function command(id: string, status: CommandView['status'], at: number): CommandView {
  return {
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
    exitCode: status === 'completed' ? 0 : null,
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
};
const client = new QueryClient();

function Turn({ commands }: { commands: CommandView[] }) {
  const parts = turnRowParts({ text: '', steps: [], commands });
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
});
