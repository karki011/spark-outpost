import '../../island/island-skin.css';
import './meeting-alert.css';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  spanOf,
  type CalendarEvent,
  type MeetingAlertAction,
  type MeetingAlertPayload,
  type MeetingAlertPlace,
} from '@spark-outpost/contracts';
import { BlobScout } from '../../brand/BlobScout.tsx';
import { sparkDesktop } from '../../desktop/desktop-bridge.ts';
import { useReducedMotion } from '../../ui/motion.ts';
import { clock } from '../calendar-format.ts';
import { joinLabel, placeRow, startsLabel, timeRow } from '../meeting-card.ts';
import { cardLead } from '../card/card-lead.ts';
import {
  CardButton,
  MeetingCardBody,
  type MeetingCardRow,
  type MoreAction,
} from '../card/MeetingCard.tsx';
import { ClockIcon, PeopleIcon, VideoIcon, WarnIcon } from '../../ui/icons.tsx';
import { JoinAtStartButton } from '../JoinAtStartButton.tsx';
import { openJoin } from '../today-model.ts';
import {
  alertDetail,
  alertTitle,
  countdownSeconds,
  joinOpensAt,
  joinState,
  parsePayload,
  parsePlace,
  rigFor,
  shortcutJoin,
} from './alert-model.ts';

const CLIMB_MS = 600;
const FADE_MS = 160;
const TICK_MS = 1_000;

function useAlertFeed() {
  const bridge = sparkDesktop()?.meetingAlert;
  const [payload, setPayload] = useState<MeetingAlertPayload | null>(null);
  const [place, setPlace] = useState<MeetingAlertPlace | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [receivedAt, setReceivedAt] = useState(0);
  useEffect(() => {
    if (!bridge) return;
    const offPayload = bridge.onPayload((value) => {
      const next = parsePayload(value);
      if (!next) return;
      setPayload(next);
      setReceivedAt(Date.now());
      setLeaving(false);
    });
    const offPlace = bridge.onPlace((value) => setPlace(parsePlace(value)));
    const offLeave = bridge.onLeave(() => setLeaving(true));
    bridge.ready();
    return () => {
      offPayload();
      offPlace();
      offLeave();
    };
  }, [bridge]);
  const clear = () => {
    setPayload(null);
    setLeaving(false);
  };
  return { payload, place, leaving, receivedAt, clear };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function JoinFor({
  event,
  at,
  leadMs,
  act,
}: {
  event: CalendarEvent;
  at: number;
  leadMs: number;
  act: Act;
}) {
  const state = joinState(event, at, leadMs);
  if (state === 'none') return null;
  if (state === 'later')
    return <span className="mc-later">Join opens at {joinOpensAt(event, leadMs)}</span>;
  return (
    <CardButton
      primary
      label={joinLabel(event)}
      ariaLabel={`${joinLabel(event)}: ${event.title}`}
      onClick={() => {
        openJoin(event.link!.url);
        act('joined', event.key);
      }}
    />
  );
}

function LeadAction({
  event,
  at,
  leadMs,
  autoJoin,
  act,
}: {
  event: CalendarEvent;
  at: number;
  leadMs: number;
  autoJoin: boolean;
  act: Act;
}) {
  const lead = cardLead(event, at);
  if (lead === 'join') return <JoinFor event={event} at={at} leadMs={leadMs} act={act} />;
  if (lead === 'planned') {
    return (
      <CardButton
        label="Don't open"
        ariaLabel={`Don't open ${event.title} at the start`}
        onClick={() => act('cancel-join-at-start', event.key)}
      />
    );
  }
  return (
    <JoinAtStartButton
      title={event.title}
      className="mc-btn primary"
      autoJoin={autoJoin}
      onAsk={() => act('join-at-start', event.key)}
    />
  );
}

function earlyJoin(event: CalendarEvent, at: number, leadMs: number, act: Act): MoreAction[] {
  if (cardLead(event, at) === 'join' || joinState(event, at, leadMs) !== 'open') return [];
  return [
    {
      label: `${joinLabel(event)} now`,
      onAct: () => {
        openJoin(event.link!.url);
        act('joined', event.key);
      },
    },
  ];
}

function PlannedNote({ event, at }: { event: CalendarEvent; at: number }) {
  if (cardLead(event, at) !== 'planned') return null;
  return <p className="mc-status">Opens 20 s before {clock(spanOf(event).start)}</p>;
}

type Act = (kind: MeetingAlertAction['kind'], eventKey?: string | null) => void;

function Countdown({ payload, at, act }: { payload: MeetingAlertPayload; at: number; act: Act }) {
  const countdown = payload.countdown;
  const target = payload.events.find((event) => event.key === countdown?.eventKey);
  if (!countdown || !target) return null;
  return (
    <div className="mc-status" role="status">
      <span>
        Joining {target.title} in {countdownSeconds(countdown.deadline, at)} s
      </span>
      <CardButton label="Cancel" onClick={() => act('cancel-join')} />
      <CardButton primary label="Join now" onClick={() => act('join-now')} />
    </div>
  );
}

function SnoozeButton({
  events,
  at,
  act,
}: {
  events: readonly CalendarEvent[];
  at: number;
  act: Act;
}) {
  const beforeStart = events.every((event) => at < spanOf(event).start);
  return beforeStart ? (
    <CardButton label="Snooze until start" onClick={() => act('snooze-until-start')} />
  ) : (
    <CardButton label="Snooze 1 min" onClick={() => act('snooze')} />
  );
}

function eventRows(event: CalendarEvent, clash: string | null): MeetingCardRow[] {
  const place = placeRow(event, null, null);
  const people = event.attendeeCount > 1 ? `${event.attendeeCount} people` : null;
  return [
    { key: 'time', icon: <ClockIcon />, text: timeRow(event) },
    ...(place ? [{ key: 'place', icon: <VideoIcon />, text: place }] : []),
    ...(people ? [{ key: 'people', icon: <PeopleIcon />, text: people }] : []),
    ...(clash ? [{ key: 'clash', icon: <WarnIcon />, text: clash, tone: 'warn' as const }] : []),
  ];
}

function ClashList({ payload, at, act }: { payload: MeetingAlertPayload; at: number; act: Act }) {
  return (
    <ul className="mc-list">
      {payload.events.map((event) => (
        <li key={event.key} className="mc-list-row">
          <span className="mc-list-text">
            <b>{event.title}</b>
            <span>{alertDetail(event)}</span>
          </span>
          <JoinFor event={event} at={at} leadMs={payload.joinLeadMs} act={act} />
        </li>
      ))}
    </ul>
  );
}

export function MeetingAlertApp() {
  const reduced = useReducedMotion();
  const bridge = sparkDesktop()?.meetingAlert;
  const { payload, place, leaving, receivedAt, clear } = useAlertFeed();
  const ticked = useNow(payload !== null && !leaving);
  const at = Math.max(ticked, receivedAt);
  const cardRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });
  const scoutRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);

  useEffect(
    () =>
      bridge?.onTakeFocus(() => {
        if (cardRef.current) cardRef.current.focus();
        else focusPending.current = true;
      }),
    [bridge],
  );

  useEffect(() => {
    if (!focusPending.current || !cardRef.current) return;
    focusPending.current = false;
    cardRef.current.focus();
  }, [payload, place]);

  const act: Act = (kind, eventKey = null) => {
    if (payload) bridge?.act({ kind, key: payload.key, eventKey });
  };

  useEffect(() => {
    if (!leaving || !bridge) return;
    const timer = setTimeout(
      () => {
        clearRef.current();
        bridge.gone();
      },
      reduced ? FADE_MS : CLIMB_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving, bridge, reduced]);

  useEffect(() => {
    if (!bridge) return;
    const measure = () => {
      const boxes = [cardRef.current, scoutRef.current].flatMap((node) => {
        if (!node) return [];
        const { x, y, width, height } = node.getBoundingClientRect();
        return [{ x, y, width, height }];
      });
      bridge.setRegions({ width: window.innerWidth, boxes, scout: null });
    };
    measure();
    const onMove = () => bridge.pointerMoved();
    document.addEventListener('animationend', measure, true);
    window.addEventListener('resize', measure);
    document.addEventListener('mousemove', onMove);
    const settle = setTimeout(measure, 1_700);
    const resized = new ResizeObserver(measure);
    if (cardRef.current) resized.observe(cardRef.current);
    return () => {
      resized.disconnect();
      clearTimeout(settle);
      document.removeEventListener('animationend', measure, true);
      window.removeEventListener('resize', measure);
      document.removeEventListener('mousemove', onMove);
    };
  }, [bridge, payload, place, leaving]);

  if (!payload || !place) return null;
  const rig = rigFor(place);
  const [first] = payload.events;
  if (!first) return null;
  const many = payload.events.length > 1;
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key === 'Escape') {
      key.preventDefault();
      act('dismiss');
    }
    if (key.key.toLowerCase() === 'j' && key.metaKey) {
      key.preventDefault();
      const joinable = shortcutJoin(payload.events, at, payload.joinLeadMs);
      if (joinable?.link) {
        openJoin(joinable.link.url);
        act('joined', joinable.key);
      } else {
        cardRef.current?.querySelector<HTMLButtonElement>('.mc-btn.primary')?.focus();
      }
    }
  };

  return (
    <div
      className="ma-root"
      data-rm={reduced || undefined}
      data-leaving={leaving || undefined}
      style={
        {
          '--rig-x': `${rig.x}px`,
          '--rig-y': `${rig.top}px`,
          '--drop': `${rig.drop}px`,
        } as CSSProperties
      }
    >
      <div className="ma-rig">
        <span className="ma-thread" aria-hidden="true" />
        <div className="ma-hang">
          <div ref={scoutRef} className="ma-scout" aria-hidden="true">
            <BlobScout size={56} mood="happy" />
          </div>
          <div
            ref={cardRef}
            className="ma-card mc"
            role="alertdialog"
            aria-labelledby="ma-kind ma-name"
            aria-describedby="ma-hint"
            onPointerDown={(down) => {
              if ((down.target as Element).closest('button')) return;
              bridge?.focus();
              cardRef.current?.focus();
            }}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            <span id="ma-kind" className="sr-only">
              Meeting.
            </span>
            <span id="ma-name" className="sr-only">
              {alertTitle(payload.events, at)}
            </span>
            <MeetingCardBody
              kicker={startsLabel(first, at)}
              title={many ? `${payload.events.length} meetings at once` : first.title}
              rows={many ? [] : eventRows(first, null)}
              list={many ? <ClashList payload={payload} at={at} act={act} /> : null}
              status={
                <>
                  {!many && <PlannedNote event={first} at={at} />}
                  <Countdown payload={payload} at={at} act={act} />
                </>
              }
              more={[
                ...(many ? [] : earlyJoin(first, at, payload.joinLeadMs, act)),
                { label: 'Open in Today', onAct: () => act('open', first.key) },
              ]}
              closeLabel={`Dismiss ${alertTitle(payload.events, at)}`}
              onClose={() => act('dismiss')}
              hint={<span id="ma-hint">Esc dismisses · ⌘J joins · ⌃⌥⌘M focuses this card</span>}
            >
              {!many && (
                <LeadAction
                  event={first}
                  at={at}
                  leadMs={payload.joinLeadMs}
                  autoJoin={payload.autoJoin}
                  act={act}
                />
              )}
              <SnoozeButton events={payload.events} at={at} act={act} />
            </MeetingCardBody>
          </div>
        </div>
      </div>
    </div>
  );
}
