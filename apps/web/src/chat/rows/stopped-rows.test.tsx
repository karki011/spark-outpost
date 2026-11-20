// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import type { RowContext } from './Rows.tsx';
import { TurnRows } from './TurnRows.tsx';
import { turnRowParts } from './turn-rows.ts';

afterEach(cleanup);

const base: RowContext = {
  runId: 'run',
  working: false,
  waiting: false,
  changes: null,
  todo: null,
  answers: new Map(),
};

const steps: StepView[] = [
  { name: 'Read `a.ts`', status: 'done', toolKind: 'read', target: 'a.ts', finishedAt: 2_000 },
  { name: 'Edit `b.ts`', status: 'open', toolKind: 'edit', target: 'b.ts', startedAt: 3_000 },
];

function Turn({ context }: { context: RowContext }) {
  return (
    <TurnRows parts={turnRowParts({ text: '', steps, commands: [] })} context={context}>
      {(text) => <p>{text}</p>}
    </TurnRows>
  );
}

describe('a step left unfinished', () => {
  it('reads Stopped with an icon when the turn was stopped', () => {
    render(<Turn context={{ ...base, stopped: true }} />);
    const word = screen.getByText('Stopped');
    expect(word.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'In progress' })).toBeNull();
  });

  it('spins while the turn is working', () => {
    render(<Turn context={{ ...base, working: true }} />);
    expect(screen.getByRole('img', { name: 'In progress' })).toBeTruthy();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  it('says nothing when the turn ended another way, such as waiting on a card or failing', () => {
    render(<Turn context={{ ...base, waiting: true }} />);
    expect(screen.queryByText('Stopped')).toBeNull();
  });
});
