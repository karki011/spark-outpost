import './ticket-comment.css';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ticketStatusLabels,
  ticketStatusSchema,
  type TicketSourceId,
  type TicketStatus,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { Glyph } from './ticket-icons.tsx';
import { refreshTicket, ticketsApi } from './tickets-api.ts';

interface MoveMenuProps {
  source: TicketSourceId;
  ticketKey: string;
  current: TicketStatus;
  sourceName: string;
}

export function MoveMenu({ source, ticketKey, current, sourceName }: MoveMenuProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (status: TicketStatus) => ticketsApi.transition(source, ticketKey, status),
    onSuccess: async (sync) => {
      setNote(sync.outcome === 'succeeded' ? null : sync.message);
      if (sync.outcome === 'succeeded') await refreshTicket(queryClient, source, ticketKey);
    },
  });
  const choices = ticketStatusSchema.options
    .filter((status) => status !== current)
    .map((status) => ({ id: status, label: ticketStatusLabels[status] }));
  const problem = move.isError ? move.error.message : note;
  return (
    <>
      <div className="tk-move">
        <ChoicePicker
          label={`Move ${ticketKey} in ${sourceName}`}
          choices={choices}
          value=""
          placeholder={move.isPending ? 'Moving…' : 'Move to…'}
          onChange={(id) => {
            if (move.isPending) return;
            setNote(null);
            move.mutate(ticketStatusSchema.parse(id));
          }}
        />
      </div>
      {problem && (
        <div className="sync fail" role="alert">
          <Glyph name="warn" />
          <span>{problem}</span>
        </div>
      )}
    </>
  );
}
