// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftLine } from './DraftLine.tsx';

afterEach(cleanup);

const PROPOSED = { chats: 3, stacked: 1, startedAt: null };
const STARTED = { ...PROPOSED, startedAt: '2026-10-09T10:30:00.000Z' };

describe('DraftLine', () => {
  it('is one line that says what was proposed and opens the review', () => {
    const onReview = vi.fn();
    const { container } = render(<DraftLine draft={PROPOSED} onReview={onReview} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.textContent).toBe('Proposed 3 chats · 1 stackedReview and start');
    const review = screen.getByRole('button', { name: 'Review and start' });
    expect(review).toHaveProperty('type', 'button');
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('says where to start it when this device cannot', () => {
    const { container } = render(<DraftLine draft={PROPOSED} />);
    expect(container.textContent).toBe('Proposed 3 chats · 1 stackedReview and start on your Mac');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Started with the outpost and opens it, with nothing left to review', () => {
    const onReview = vi.fn();
    const onOpenOutpost = vi.fn();
    const { container } = render(
      <DraftLine
        draft={STARTED}
        outpostName="Orders launch"
        onReview={onReview}
        onOpenOutpost={onOpenOutpost}
      />,
    );
    expect(container.textContent).toBe('Started 3 chats · 1 stackedOrders launchOpen outpost');
    expect(screen.queryByRole('button', { name: 'Review and start' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open outpost Orders launch' }));
    expect(onOpenOutpost).toHaveBeenCalledTimes(1);
    expect(onReview).not.toHaveBeenCalled();
  });

  it('is plain text when the started outpost is not known here', () => {
    const { container } = render(<DraftLine draft={STARTED} />);
    expect(container.textContent).toBe('Started 3 chats · 1 stacked');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
