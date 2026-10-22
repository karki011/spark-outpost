// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPARK_ACTION_OPTION, type Approval } from '@spark-outpost/contracts';
import { AskCard } from './AskCard.tsx';

const OPTIONS = [
  { optionId: SPARK_ACTION_OPTION.confirm, name: 'Allow for this chat', kind: 'allow_once' },
  { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
];

function card(sparkAction: unknown, extra: Record<string, unknown> = {}): Approval {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    toolCallId: 'call',
    kind: 'spark_action',
    title: 'A card',
    payload: { sparkAction, ...extra },
    payloadHash: 'hash',
    options: OPTIONS,
    status: 'pending',
    reason: null,
  } as unknown as Approval;
}

function show(approval: Approval, onOpen = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AskCard approval={approval} conversationId="chat" onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

afterEach(cleanup);

describe('AskCard', () => {
  it('answers a calendar read card in the island', () => {
    show(card({ action: 'calendar_read', what: 'Events tomorrow' }));
    expect(screen.getByRole('button', { name: 'Allow for this chat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review in Spark' })).toBeNull();
  });

  it('sends a calendar change to Spark with a focusable button', () => {
    const onOpen = show(card({ action: 'calendar_edit', op: 'delete' }));
    expect(screen.queryByRole('button', { name: 'Allow for this chat' })).toBeNull();
    const review = screen.getByRole('button', { name: 'Review in Spark' });
    review.focus();
    expect(document.activeElement).toBe(review);
    fireEvent.click(review);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('sends a hold-to-confirm card to Spark even for a page read', () => {
    show(card({ action: 'open_page', url: 'https://example.com' }, { secretSend: ['.env'] }));
    expect(screen.getByRole('button', { name: 'Review in Spark' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow for this chat' })).toBeNull();
  });
});
