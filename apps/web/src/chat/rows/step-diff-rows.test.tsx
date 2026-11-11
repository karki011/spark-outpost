// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StepDiff } from '@spark-outpost/contracts';
import type { StepView } from '../run-projection.ts';
import type { RowContext } from './Rows.tsx';
import { TurnRows } from './TurnRows.tsx';
import { turnRowParts } from './turn-rows.ts';

afterEach(cleanup);

const context: RowContext = {
  runId: 'run',
  working: false,
  waiting: false,
  changes: null,
  todo: null,
  answers: new Map(),
};

const edit = (target: string, diffs: StepDiff[]): StepView => ({
  name: `Edit \`${target}\``,
  status: 'done',
  toolKind: 'edit',
  target,
  diffs,
});

const notes: StepDiff = {
  path: 'src/notes.ts',
  added: 2,
  removed: 1,
  oldText: 'one\ntwo\n',
  newText: 'one\n2\nthree\n',
};

function Turn({ steps }: { steps: StepView[] }) {
  return (
    <TurnRows parts={turnRowParts({ text: '', steps, commands: [] })} context={context}>
      {(text) => <p>{text}</p>}
    </TurnRows>
  );
}

const header = () => screen.getByRole('button', { name: /src\/notes\.ts/ });

describe('diffs on edit steps', () => {
  it('shows the path with +N −M and keeps the diff closed until asked', () => {
    render(<Turn steps={[edit('src/notes.ts', [notes])]} />);
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(header().textContent).toContain('+2');
    expect(header().textContent).toContain('−1');
    expect(screen.queryByRole('region', { name: /Changes to src\/notes\.ts/ })).toBeNull();
  });

  it('opens and closes the diff from the keyboard-reachable button and keeps focus', () => {
    render(<Turn steps={[edit('src/notes.ts', [notes])]} />);
    header().focus();
    fireEvent.click(header());
    expect(header().getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(header().getAttribute('aria-controls')!)!;
    expect(body.textContent).toContain('three');
    expect(document.activeElement).toBe(header());
    fireEvent.click(header());
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(body.id)).toBeNull();
  });

  it('stays open, focused and the same element when more steps arrive', () => {
    const first = edit('src/notes.ts', [notes]);
    const view = render(<Turn steps={[first]} />);
    header().focus();
    fireEvent.click(header());
    const opened = header();
    view.rerender(
      <Turn
        steps={[first, { name: 'Read `b.ts`', status: 'open', toolKind: 'read', target: 'b.ts' }]}
      />,
    );
    expect(header()).toBe(opened);
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(opened);
  });

  it('keeps an opened diff open and focused when a second edit joins it in a group', () => {
    const first = edit('src/notes.ts', [notes]);
    const second = edit('src/other.ts', [{ ...notes, path: 'src/other.ts' }]);
    const view = render(<Turn steps={[first]} />);
    header().focus();
    fireEvent.click(header());
    view.rerender(<Turn steps={[first, second]} />);
    expect(
      screen.getByRole('button', { name: /Edited 2 files/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('button', { name: /src\/other\.ts/ }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('shows the diffs of two grouped edits once the group is opened', () => {
    const first = edit('src/notes.ts', [notes]);
    const second = edit('src/other.ts', [{ ...notes, path: 'src/other.ts' }]);
    render(<Turn steps={[first, second]} />);
    expect(screen.queryByRole('button', { name: /src\/notes\.ts/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Edited 2 files/ }));
    fireEvent.click(header());
    expect(header().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the end of a long absolute path and the whole path on hover', () => {
    const long = '/Users/me/work/app/src/notes.ts';
    render(<Turn steps={[edit('notes.ts', [{ ...notes, path: long }])]} />);
    const code = screen.getByText('app/src/notes.ts', { selector: 'code' });
    expect(code.getAttribute('title')).toBe(long);
  });

  it('notes a diff that was cut short', () => {
    render(<Turn steps={[edit('src/notes.ts', [{ ...notes, truncated: true }])]} />);
    fireEvent.click(header());
    expect(screen.getByText(/Only the start of this change/)).toBeTruthy();
  });

  it('shows only the path for a secret file, with nothing to open', () => {
    const secret: StepDiff = { path: '.env', added: 0, removed: 0, withheld: true };
    render(<Turn steps={[edit('.env', [secret])]} />);
    expect(screen.getAllByText('.env', { selector: 'code' }).length).toBeGreaterThan(1);
    expect(screen.getByText(/secret file/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /\.env/ })).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
