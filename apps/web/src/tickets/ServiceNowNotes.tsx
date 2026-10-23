import './servicenow-notes.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TICKET_COMMENT_MAX_LENGTH,
  type TicketCommentVisibility,
  type TicketDetail,
} from '@spark-outpost/contracts';
import { DisconnectDialog } from '../connectors/DisconnectDialog.tsx';
import { LockIcon, PeopleIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const VISIBILITY_WORDS: Record<TicketCommentVisibility, string> = {
  internal: 'Internal',
  customer: 'Caller sees it',
};

export function VisibilityTag({ visibility }: { visibility: TicketCommentVisibility }) {
  return (
    <span className={`sn-vis sn-vis-${visibility}`}>
      {visibility === 'internal' ? <LockIcon /> : <PeopleIcon />}
      {VISIBILITY_WORDS[visibility]}
    </span>
  );
}

const KINDS = [
  { id: 'internal', label: 'Work note · internal' },
  { id: 'customer', label: 'Comment · caller sees it' },
];

function confirmCopy(ticket: TicketDetail) {
  const caller = ticket.reporter?.name;
  return {
    title: 'Post a comment the caller sees?',
    text: `${caller ? `${caller} and the watchers` : 'The caller and watchers'} of ${ticket.key} see it, and your instance may email it to them.`,
  };
}

export function ServiceNowNotes({ ticket }: { ticket: TicketDetail }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [kind, setKind] = useState<TicketCommentVisibility>('internal');
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const post = useMutation({
    mutationFn: (visibility: TicketCommentVisibility) =>
      ticketsApi.comment(ticket.source, ticket.key, {
        body: text,
        ...(visibility === 'customer' ? { visibility } : {}),
      }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ticketKeys.view(ticket.source, ticket.key) });
    },
  });
  const customer = kind === 'customer';
  const label = customer ? 'Comment the caller sees' : 'Work note';
  const send = () => {
    if (customer) setConfirming(true);
    else post.mutate('internal');
  };
  return (
    <section className="tk-sec sn-notes" aria-label="Add a work note or comment">
      <Segmented
        ariaLabel="Note kind"
        options={KINDS}
        value={kind}
        onChange={(id) => setKind(id as TicketCommentVisibility)}
      />
      <label className="sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className="inp sn-note-text"
        rows={3}
        maxLength={TICKET_COMMENT_MAX_LENGTH}
        placeholder={customer ? 'Write to the caller…' : 'Add a work note…'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={post.isPending}
      />
      {post.isError && (
        <p className="gh-err" role="alert">
          {post.error.message}
        </p>
      )}
      {post.isSuccess && (
        <p className="tk-quiet" role="status">
          {post.variables === 'customer' ? 'Comment posted.' : 'Work note added.'}
        </p>
      )}
      <div className="sn-note-acts">
        <button
          type="button"
          className={customer ? 'btn line sm' : 'btn primary sm'}
          disabled={post.isPending || text.trim().length === 0}
          onClick={send}
        >
          {customer ? 'Post comment the caller sees…' : 'Add work note'}
        </button>
      </div>
      {confirming && (
        <DisconnectDialog
          copy={confirmCopy(ticket)}
          confirmLabel="Post comment"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            post.mutate('customer');
          }}
        />
      )}
    </section>
  );
}
