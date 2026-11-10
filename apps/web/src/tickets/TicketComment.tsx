import './ticket-comment.css';
import { useId, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TICKET_COMMENT_MAX_LENGTH, type TicketSourceId } from '@spark-outpost/contracts';
import { hasModifier } from '../ui/shortcuts.ts';
import { refreshTicket, ticketsApi } from './tickets-api.ts';

interface TicketCommentProps {
  source: TicketSourceId;
  ticketKey: string;
  sourceName: string;
}

export function TicketComment({ source, ticketKey, sourceName }: TicketCommentProps) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState('');
  const post = useMutation({
    mutationFn: (body: string) => ticketsApi.comment(source, ticketKey, { body }),
    onSuccess: async () => {
      setText('');
      await refreshTicket(queryClient, source, ticketKey);
    },
  });
  const empty = text.trim().length === 0;
  const send = () => {
    if (!empty && !post.isPending) post.mutate(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && hasModifier(event.nativeEvent)) {
      event.preventDefault();
      send();
    }
  };
  return (
    <section className="tk-sec tk-comment" aria-label="Add a comment">
      <label className="sr-only" htmlFor={fieldId}>
        Comment on {ticketKey}
      </label>
      <textarea
        id={fieldId}
        className="inp tk-comment-text"
        rows={3}
        maxLength={TICKET_COMMENT_MAX_LENGTH}
        placeholder={`Comment in ${sourceName}…`}
        value={text}
        disabled={post.isPending}
        onChange={(event) => {
          if (post.isError) post.reset();
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {post.isError && (
        <p className="gh-err" role="alert">
          Couldn't post the comment. {post.error.message}
        </p>
      )}
      <div className="tk-comment-acts">
        <button
          type="button"
          className="btn primary sm"
          disabled={empty || post.isPending}
          onClick={send}
        >
          {post.isPending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </section>
  );
}
