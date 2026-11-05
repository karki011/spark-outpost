// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnOutcome } from '@spark-outpost/contracts';
import { outcomeKeys } from '../../api/outcomes.ts';
import type { FeedbackVariant } from './feedback-host.ts';
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

function show(changes: Partial<TurnOutcome> = {}, variant: FeedbackVariant = 'turn') {
  const client = new QueryClient();
  client.setQueryData(outcomeKeys.run(runId), { outcome: { ...outcome, ...changes } });
  render(
    <QueryClientProvider client={client}>
      <TurnFeedback runId={runId} variant={variant} />
    </QueryClientProvider>,
  );
}

const group = (name: string) => screen.getByRole('group', { name });

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

describe('TurnFeedback under a turn', () => {
  it('never shows the question and is never dimmed', () => {
    for (const prompt of ['sampled', null] as const) {
      show({ prompt, feedback: null });
      expect(group('How did it go?').className).not.toContain('quiet');
      expect(screen.getByText('How did it go?').className).toBe('sr-only');
      cleanup();
    }
  });

  it('stays a pair of thumbs on the result line, and asks out loud after a revert', () => {
    show({ prompt: 'mixed', feedback: null }, 'kept');
    expect(screen.getByText('How did it go?').className).toBe('sr-only');
    cleanup();

    show({ prompt: 'mixed', feedback: null }, 'reverted');
    expect(screen.getByText('What went wrong?').className).toBe('fb-q');
    cleanup();

    show({ prompt: null, feedback: null }, 'reverted');
    expect(screen.getByText('What went wrong?').className).toBe('fb-q');
  });
});
