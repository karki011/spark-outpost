// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { InboxTicket, TicketInbox } from '@spark-outpost/contracts';
import { ticketKeys } from './tickets-api.ts';
import { useInboxMarks } from './use-inbox-marks.ts';

const ticket = (key: string, section: InboxTicket['section']) =>
  ({ source: 'jira', key, section }) as InboxTicket;

function setUp() {
  const client = new QueryClient();
  client.setQueryData(ticketKeys.inbox, {
    tickets: [ticket('WEB-1', 'attention'), ticket('WEB-2', 'attention')],
  } as TicketInbox);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const marks = renderHook(() => useInboxMarks(), { wrapper }).result.current;
  const sections = () =>
    client.getQueryData<TicketInbox>(ticketKeys.inbox)!.tickets.map((entry) => entry.section);
  return { client, invalidate, marks, sections };
}

it('puts the one ticket back and reads the inbox again when the last mark fails', async () => {
  const { invalidate, marks, sections } = setUp();
  const context = await marks.apply(ticket('WEB-1', 'attention'), ticket('WEB-1', 'up_next'));
  expect(sections()).toEqual(['up_next', 'attention']);
  marks.rollback(context);
  expect(sections()).toEqual(['attention', 'attention']);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ticketKeys.inbox, exact: true });
});

it('leaves the inbox alone on a failure while other marks are still in flight', async () => {
  const { client, invalidate, marks } = setUp();
  vi.spyOn(client, 'isMutating').mockReturnValue(2);
  const context = await marks.apply(ticket('WEB-1', 'attention'), ticket('WEB-1', 'up_next'));
  marks.rollback(context);
  expect(invalidate).not.toHaveBeenCalled();
});
