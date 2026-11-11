// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SubagentDetail } from './SubagentDetail.tsx';

afterEach(cleanup);

const LONG_TASK = [
  '## Goal',
  'Add the **token usage** page.',
  '',
  '- one',
  '- two',
  '- three',
  '',
  'More.',
].join('\n');

function row(change: Partial<SubagentRow> = {}): SubagentRow {
  return {
    ...emptySubagentRecord,
    id: 'a',
    name: 'Builder: token usage',
    task: LONG_TASK,
    parentId: null,
    state: 'done',
    step: null,
    startedAt: null,
    endedAt: null,
    ...change,
  };
}

describe('SubagentDetail', () => {
  it('formats the brief and folds a long one until asked', () => {
    render(<SubagentDetail id="d" row={row()} task={LONG_TASK} live={false} />);
    const brief = screen.getByRole('region', { name: 'Brief' });
    expect(within(brief).getByRole('heading', { name: 'Goal' })).toBeTruthy();
    expect(within(brief).getByText('token usage').tagName).toBe('STRONG');
    expect(within(brief).getAllByRole('listitem')).toHaveLength(3);
    const more = within(brief).getByRole('button', { name: 'Show the full brief' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(brief).getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('shows a short brief whole, with no toggle', () => {
    render(<SubagentDetail id="d" row={row()} task="Find the routes." live={false} />);
    const brief = screen.getByRole('region', { name: 'Brief' });
    expect(within(brief).queryByRole('button')).toBeNull();
  });

  it('formats the report', () => {
    const message = 'Done.\n\n- Added `TokenUsage.tsx`\n- Tests pass';
    render(<SubagentDetail id="d" row={row({ message })} task={null} live={false} />);
    const report = screen.getByRole('region', { name: 'Its report' });
    expect(within(report).getAllByRole('listitem')).toHaveLength(2);
    expect(within(report).getByText('TokenUsage.tsx').tagName).toBe('CODE');
  });
});
