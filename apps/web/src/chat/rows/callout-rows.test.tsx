// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StepView } from '../run-projection.ts';
import type { RowContext } from './Rows.tsx';
import { TurnRows } from './TurnRows.tsx';
import { turnRowParts } from './turn-rows.ts';

afterEach(cleanup);

const context: RowContext = {
  runId: 'run',
  working: true,
  waiting: false,
  changes: null,
  todo: null,
  answers: new Map(),
};

const open = (status: StepView['status']): StepView => ({
  name: 'Opening a page in the browser',
  status,
  toolKind: 'other',
  toolName: 'mcp__spark__spark_browser_open',
  target: 'cloudzero.com',
  startedAt: 1_000,
  ...(status === 'open' ? {} : { finishedAt: 4_000 }),
});

const reads: StepView[] = ['a.ts', 'b.ts'].map((file) => ({
  name: `Read \`${file}\``,
  status: 'done',
  toolKind: 'read',
  target: file,
}));

function Turn({ steps }: { steps: StepView[] }) {
  return (
    <TurnRows parts={turnRowParts({ text: '', steps, commands: [] })} context={context}>
      {(text) => <p>{text}</p>}
    </TurnRows>
  );
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('callout rows', () => {
  it('shows a callout beside the closed group, closed until asked, with its details', () => {
    render(<Turn steps={[...reads, open('done')]} />);
    expect(row(/Read 2 files/).getAttribute('aria-expanded')).toBe('false');
    const callout = row(/Opened cloudzero\.com/);
    expect(callout.getAttribute('aria-expanded')).toBe('false');
    expect(callout.textContent).toContain('3s');
    fireEvent.click(callout);
    expect(callout.getAttribute('aria-expanded')).toBe('true');
    const details = document.getElementById(callout.getAttribute('aria-controls')!)!;
    expect(details.textContent).toContain('spark_browser_open');
    expect(details.textContent).toContain('Done');
    fireEvent.click(callout);
    expect(callout.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
  });

  it('runs live in its own row and keeps the same row open and focused once it finishes', () => {
    const view = render(<Turn steps={[...reads, open('open')]} />);
    const live = row(/Opening cloudzero\.com/);
    expect(live.querySelector('[aria-label="In progress"]')).toBeTruthy();
    expect(row(/Read 2 files/).textContent).not.toContain('cloudzero');
    live.focus();
    fireEvent.click(live);
    view.rerender(<Turn steps={[...reads, open('done')]} />);
    const finished = row(/Opened cloudzero\.com/);
    expect(finished).toBe(live);
    expect(finished.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(finished);
  });

  it('opens a failed callout and says it failed in words', () => {
    render(<Turn steps={[open('failed')]} />);
    const failed = row(/Opened cloudzero\.com/);
    expect(failed.getAttribute('aria-expanded')).toBe('true');
    expect(failed.textContent).toContain('failed');
  });
});
