import { spanOf, type CalendarEvent, type ConversationSummary } from '@spark-outpost/contracts';
import { CALENDAR_SERVICE_NAMES } from '@spark-outpost/contracts';
import { clock, duration } from '../calendar/calendar-format.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { HomeLead, LeadGroup, Quiet } from './HomeCards.tsx';
import type { NeedItem, RunItem } from './home-model.ts';
import type { CapabilitiesByProvider } from './run-mode.ts';
import { RunRows, WaitingRows } from './LeadRows.tsx';
import type { MeetingLead as MeetingActions } from './use-meeting-lead.ts';

interface MeetingLeadProps {
  event: CalendarEvent;
  clashes: readonly string[] | undefined;
  actions: MeetingActions;
  now: number;
  waiting: readonly NeedItem[];
  running: readonly RunItem[];
  capabilities: CapabilitiesByProvider;
  onOpen: (chat: ConversationSummary) => void;
}

function meetingMeta(event: CalendarEvent): string {
  const { start, end } = spanOf(event);
  return [
    `${clock(start)} to ${clock(end)}`,
    event.link ? CALENDAR_SERVICE_NAMES[event.link.service] : null,
    duration(Math.round((end - start) / 60_000)),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MeetingLead(props: MeetingLeadProps) {
  const { event, actions, waiting, running } = props;
  return (
    <HomeLead
      id="home-lead-h"
      title={event.title}
      meta={
        <>
          {meetingMeta(event)} <ClashTag titles={props.clashes} />
        </>
      }
      className="hlead-meeting"
      action={
        <span className="hlead-acts">
          <button type="button" className="btn sm line" onClick={() => actions.dismiss(event)}>
            Dismiss
          </button>
          <button type="button" className="btn sm line" onClick={() => actions.snooze(event)}>
            Snooze 1 min
          </button>
          <JoinButton event={event} now={props.now} onJoined={actions.joined} />
        </span>
      }
    >
      <p className="hlead-kick">Before you go in</p>
      {waiting.length > 0 && (
        <LeadGroup id="lead-stall" title="Will stall without you">
          <WaitingRows label="Will stall without you" items={waiting} onOpen={props.onOpen} />
        </LeadGroup>
      )}
      {running.length > 0 && (
        <LeadGroup id="lead-working" title="Still working">
          <RunRows
            label="Still working"
            items={running}
            capabilities={props.capabilities}
            onOpen={props.onOpen}
          />
        </LeadGroup>
      )}
      {waiting.length === 0 && running.length === 0 && (
        <Quiet>Nothing is waiting on you and nothing is running.</Quiet>
      )}
    </HomeLead>
  );
}
