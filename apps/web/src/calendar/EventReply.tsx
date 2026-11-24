import './event-reply.css';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  googleEventAccountId,
  type CalendarEvent,
  type CalendarReply,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import { InfoTip } from '../ui/InfoTip.tsx';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import { useCalendarStatus } from './use-calendar.ts';
import { useCloudSignIn } from './use-cloud-calendar.ts';

const CHOICES: readonly { reply: CalendarReply; label: string }[] = [
  { reply: 'accepted', label: 'Yes' },
  { reply: 'declined', label: 'No' },
  { reply: 'tentative', label: 'Maybe' },
];

function useReply(event: CalendarEvent) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reply: CalendarReply) =>
      calendarApi.reply({
        eventId: event.id,
        start: event.start,
        calendarKey: event.calendarKey,
        reply,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: calendarKeys.all,
        predicate: (query) => query.queryKey[1] !== 'status',
      }),
  });
}

interface AllowGoogleChangesProps {
  accountId: string;
  flow: GoogleSignInFlow;
  label: string;
  hint: string;
}

export function AllowGoogleChanges(props: AllowGoogleChangesProps) {
  const { flow, start } = useCloudSignIn('google', props.flow, true);
  const waiting = flow.status === 'waiting';
  const failed = flow.status === 'failed' ? flow.message : null;
  return (
    <div className="ev-reply">
      <div className="ev-reply-row">
        <button
          type="button"
          className="btn line sm"
          disabled={start.isPending || waiting}
          onClick={() =>
            start.mutate({ accountId: props.accountId, editCalendar: null, replies: true })
          }
        >
          {waiting ? 'Waiting for Google…' : props.label}
        </button>
        <InfoTip topic={props.label.toLowerCase()} text={props.hint} />
      </div>
      {(start.error || failed) && (
        <p className="home-error" role="alert">
          {start.error?.message ?? failed}
        </p>
      )}
    </div>
  );
}

export function EventReply({ event }: { event: CalendarEvent }) {
  const status = useCalendarStatus();
  const send = useReply(event);
  const accountId = googleEventAccountId(event.id);
  const account = status.data?.google.accounts.find((item) => item.id === accountId);
  if (!accountId || !account || event.myStatus === 'none') return null;
  if (!account.canEdit) {
    return (
      <AllowGoogleChanges
        accountId={accountId}
        flow={status.data!.google.signIn}
        label="Allow replies"
        hint={`Google asks in your browser to let Spark change events for ${account.email}. Spark uses it to send your reply.`}
      />
    );
  }
  const current = send.isPending ? send.variables : event.myStatus;
  return (
    <div className="ev-reply">
      <div className="ev-reply-row" role="group" aria-label="Going?">
        <span className="ev-reply-ask" aria-hidden="true">
          Going?
        </span>
        <InfoTip topic="replies" text="Google tells the organiser and guests." />
        {CHOICES.map((choice) => (
          <button
            key={choice.reply}
            type="button"
            className="btn line sm"
            aria-pressed={current === choice.reply}
            disabled={send.isPending}
            onClick={() => send.mutate(choice.reply)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {send.error && (
        <p className="home-error" role="alert">
          {send.error.message}
        </p>
      )}
    </div>
  );
}
