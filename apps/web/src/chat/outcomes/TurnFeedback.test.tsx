// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnOutcome } from '@spark-outpost/contracts';
import { outcomeKeys } from '../../api/outcomes.ts';
import { TurnFeedback } from './TurnFeedback.tsx';

afterEach(cleanup);

const runId = '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d';

const outcome = {
  runId,
  taskId: null,
  kind: 'answer',
  score: null,
  verdict: 'unknown',
  reasons: [],
  prompt: null,
  feedback: { rating: 'up', reasons: [], comment: '' },
  signals: [],
} as unknown as TurnOutcome;

function show() {
  const client = new QueryClient();
  client.setQueryData(outcomeKeys.run(runId), { outcome });
  render(
    <QueryClientProvider client={client}>
      <TurnFeedback runId={runId} variant="turn" />
    </QueryClientProvider>,
  );
}

const note = () => screen.getByLabelText('Comment (optional)', { selector: 'textarea' });
const reveal = () => note().closest('.fb-note-reveal') as HTMLElement;

describe('TurnFeedback comment', () => {
  it('opens and closes the comment without animating its height', () => {
    show();
    expect(reveal().hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add a comment' }));
    expect(reveal().hasAttribute('inert')).toBe(false);
    expect(reveal().className).toContain('open');
    expect(reveal().style.height).toBe('');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    expect(reveal().hasAttribute('inert')).toBe(true);
    expect(reveal().className).not.toContain('open');
    expect(reveal().style.height).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Good result' }));
  });
});
