import { Children, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  joinOpen,
  spanOf,
  type CalendarEvent,
  type CalendarEventDetail,
  type CalendarPerson,
} from '@spark-outpost/contracts';
import { clock } from './calendar-format.ts';
import { useCopyText } from './copy-toast.tsx';
import { agendaMarkdown } from './agenda-markdown.ts';
import {
  descriptionParts,
  linkPart,
  looksLikeAddress,
  mapsUrl,
  type DescriptionPart,
} from './description-parts.ts';
import { initials } from './month-model.ts';
import { openJoin } from './today-model.ts';
import { useEventDetail, useJoinLeadMs } from './use-calendar.ts';

interface WithEvent {
  event: CalendarEvent;
  now: number;
}

function JoinLinkPart({
  part,
  event,
  now,
}: WithEvent & { part: DescriptionPart & { kind: 'link' } }) {
  const leadMs = useJoinLeadMs();
  const { start, end } = spanOf(event);
  const open = joinOpen({ start, end }, now, leadMs);
  const why = now >= end ? 'The meeting has ended' : `Join opens at ${clock(start - leadMs)}`;
  return (
    <button
      type="button"
      className="cal-link"
      aria-disabled={!open || undefined}
      title={open ? `Join ${event.title}` : why}
      aria-label={open ? `Join ${event.title} at ${part.host}` : `${part.host}, ${why}`}
      onClick={() => {
        if (open && part.join) openJoin(part.join.url);
      }}
    >
      {part.host}
    </button>
  );
}

function Part({ part, event, now }: WithEvent & { part: DescriptionPart }) {
  const copy = useCopyText();
  if (part.kind === 'text') return part.text;
  if (part.kind === 'phone') {
    return (
      <button
        type="button"
        className="cal-link"
        title="Copy the number"
        aria-label={`Copy phone number ${part.text}`}
        onClick={() => copy(part.number)}
      >
        {part.text}
      </button>
    );
  }
  if (part.join) return <JoinLinkPart part={part} event={event} now={now} />;
  return (
    <button
      type="button"
      className="cal-link"
      title={part.url}
      aria-label={`Open ${part.host} in your browser`}
      onClick={() => openJoin(part.url)}
    >
      {part.host}
    </button>
  );
}

function LinkedText({ text, event, now }: WithEvent & { text: string }) {
  return descriptionParts(text).map((part, index) => (
    <Part key={index} part={part} event={event} now={now} />
  ));
}

const AGENDA_ELEMENTS = ['p', 'ul', 'ol', 'li', 'a', 'br'];

function agendaComponents({ event, now }: WithEvent): Components {
  const linked = (children: ReactNode) =>
    Children.map(children, (child) =>
      typeof child === 'string' ? <LinkedText text={child} event={event} now={now} /> : child,
    );
  return {
    p: ({ children }) => <p>{linked(children)}</p>,
    li: ({ children }) => <li>{linked(children)}</li>,
    a: ({ href, children }) => {
      const part = href ? linkPart(href) : null;
      return part ? <Part part={part} event={event} now={now} /> : <span>{children}</span>;
    },
  };
}

function Agenda({ text, event, now }: WithEvent & { text: string }) {
  return (
    <div className="cal-agenda">
      <ReactMarkdown
        skipHtml
        allowedElements={AGENDA_ELEMENTS}
        unwrapDisallowed
        components={agendaComponents({ event, now })}
      >
        {agendaMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

export function EventDescription({
  detail,
  event,
  now,
}: WithEvent & { detail: CalendarEventDetail }) {
  if (!detail.agenda && !detail.conference) return null;
  return (
    <div className="cal-desc">
      {detail.agenda && <Agenda text={detail.agenda} event={event} now={now} />}
      {detail.conference && (
        <details className="cal-conf">
          <summary>Dial-in and meeting details</summary>
          <p>
            <LinkedText text={detail.conference} event={event} now={now} />
          </p>
        </details>
      )}
    </div>
  );
}

export function EventLocation({ location, event, now }: WithEvent & { location: string | null }) {
  if (!location) return null;
  const address = looksLikeAddress(location);
  return (
    <p className="cal-where">
      <span className="cal-where-text" title={location}>
        {address ? location : <LinkedText text={location} event={event} now={now} />}
      </span>
      {address && (
        <button
          type="button"
          className="cal-link"
          aria-label={`Open ${location} in Maps`}
          onClick={() => openJoin(mapsUrl(location))}
        >
          Open in Maps
        </button>
      )}
    </p>
  );
}

function Person({ person }: { person: CalendarPerson }) {
  const copy = useCopyText();
  const face = <i aria-hidden="true">{initials(person.name)}</i>;
  const email = person.email && person.email !== person.name ? person.email : null;
  const text = (
    <span className="cal-person-text">
      <span className="cal-person-name">{person.name}</span>
      {email && <small>{email}</small>}
    </span>
  );
  if (!person.email) {
    return (
      <span className="cal-person" title={person.name}>
        {face}
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cal-person"
      title={person.email}
      aria-label={`${person.name}${email ? `, ${email}` : ''}, copy email`}
      onClick={() => copy(person.email!)}
    >
      {face}
      {text}
    </button>
  );
}

interface AttendeesProps {
  people: readonly CalendarPerson[];
  count: number;
  shown: number;
  expandable?: boolean;
}

export function Attendees({ people, count, shown, expandable = false }: AttendeesProps) {
  const [all, setAll] = useState(false);
  if (people.length === 0) {
    return count > 1 ? <p className="cal-people-count">{count} people</p> : null;
  }
  const visible = all ? people : people.slice(0, shown);
  const rest = people.length - visible.length;
  return (
    <ul className="cal-people" aria-label="People">
      {visible.map((person, index) => (
        <li key={`${person.email ?? person.name}-${index}`}>
          <Person person={person} />
        </li>
      ))}
      {rest > 0 && (
        <li className="cal-people-more">
          {expandable ? (
            <button type="button" className="cal-link" onClick={() => setAll(true)}>
              +{rest} more
            </button>
          ) : (
            `+${rest} more`
          )}
        </li>
      )}
    </ul>
  );
}

const PEOPLE_SHOWN = 3;

export function EventInfo({ event, now }: WithEvent) {
  const detail = useEventDetail(event, true);
  const data = detail.data;
  if (!data) return null;
  return (
    <div className="cal-info">
      <EventLocation location={data.location} event={event} now={now} />
      <EventDescription detail={data} event={event} now={now} />
      <Attendees
        people={data.attendees}
        count={event.attendeeCount}
        shown={PEOPLE_SHOWN}
        expandable
      />
    </div>
  );
}
