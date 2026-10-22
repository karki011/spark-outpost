import '../../island/island-skin.css';
import './meeting-alert.css';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type {
  CalendarEvent,
  MeetingAlertAction,
  MeetingAlertPayload,
  MeetingAlertPlace,
} from '@spark-outpost/contracts';
import { BlobScout } from '../../brand/BlobScout.tsx';
import { sparkDesktop } from '../../desktop/desktop-bridge.ts';
import { useThemeSync } from '../../island/use-theme-sync.ts';
import { useReducedMotion } from '../../ui/motion.ts';
import { joinLabel } from '../meeting-card.ts';
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
  useEffect(() => {
    if (!bridge) return;
    const offPayload = bridge.onPayload((value) => {
      const next = parsePayload(value);
      if (!next) return;
      setPayload(next);
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
  return { payload, place, leaving, clear };
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

function JoinFor({ event, at, act }: { event: CalendarEvent; at: number; act: Act }) {
  const state = joinState(event, at);
  if (state === 'none') return null;
  if (state === 'later')
    return <span className="ma-later">Join opens at {joinOpensAt(event)}</span>;
  return (
    <button
      type="button"
      className="ma-btn primary"
      onClick={() => {
        openJoin(event.link!.url);
        act('joined', event.key);
      }}
    >
      {joinLabel(event)}
    </button>
  );
}

type Act = (kind: MeetingAlertAction['kind'], eventKey?: string | null) => void;

function Countdown({ payload, at, act }: { payload: MeetingAlertPayload; at: number; act: Act }) {
  const countdown = payload.countdown;
  const target = payload.events.find((event) => event.key === countdown?.eventKey);
  if (!countdown || !target) return null;
  return (
    <div className="ma-countdown" role="status">
      <span>
        Joining {target.title} in {countdownSeconds(countdown.deadline, at)} s
      </span>
      <button type="button" className="ma-btn" onClick={() => act('cancel-join')}>
        Cancel
      </button>
      <button type="button" className="ma-btn primary" onClick={() => act('join-now')}>
        Join now
      </button>
    </div>
  );
}

export function MeetingAlertApp() {
  useThemeSync();
  const reduced = useReducedMotion();
  const bridge = sparkDesktop()?.meetingAlert;
  const { payload, place, leaving, clear } = useAlertFeed();
  const at = useNow(payload !== null && !leaving);
  const cardRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });
  const scoutRef = useRef<HTMLDivElement>(null);

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
    return () => {
      clearTimeout(settle);
      document.removeEventListener('animationend', measure, true);
      window.removeEventListener('resize', measure);
      document.removeEventListener('mousemove', onMove);
    };
  }, [bridge, payload, place, leaving]);

  if (!payload || !place) return null;
  const rig = rigFor(place);
  const [first] = payload.events;
  const onKeyDown = (key: KeyboardEvent) => {
    if (key.key === 'Escape') {
      key.preventDefault();
      act('dismiss');
    }
    if (key.key.toLowerCase() === 'j' && key.metaKey) {
      key.preventDefault();
      const joinable = shortcutJoin(payload.events, at);
      if (joinable?.link) {
        openJoin(joinable.link.url);
        act('joined', joinable.key);
      } else {
        cardRef.current?.querySelector<HTMLButtonElement>('.ma-btn.primary')?.focus();
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
            className="ma-card"
            role="alertdialog"
            aria-labelledby="ma-title"
            aria-describedby="ma-hint"
            onPointerDown={(down) => {
              if ((down.target as Element).closest('button')) return;
              bridge?.focus();
              cardRef.current?.focus();
            }}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            <h1 id="ma-title" className="ma-title">
              {alertTitle(payload.events, at)}
            </h1>
            {payload.events.length === 1 && first ? (
              <>
                <p className="ma-detail">{alertDetail(first)}</p>
                <Countdown payload={payload} at={at} act={act} />
                <div className="ma-acts">
                  <JoinFor event={first} at={at} act={act} />
                  <button type="button" className="ma-btn" onClick={() => act('snooze')}>
                    Snooze 1 min
                  </button>
                  <button type="button" className="ma-btn" onClick={() => act('dismiss')}>
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              <>
                <ul className="ma-list">
                  {payload.events.map((event) => (
                    <li key={event.key} className="ma-row">
                      <span className="ma-row-text">
                        <b>{event.title}</b>
                        <span>{alertDetail(event)}</span>
                      </span>
                      <JoinFor event={event} at={at} act={act} />
                    </li>
                  ))}
                </ul>
                <div className="ma-acts">
                  <button type="button" className="ma-btn" onClick={() => act('snooze')}>
                    Snooze 1 min
                  </button>
                  <button type="button" className="ma-btn" onClick={() => act('dismiss')}>
                    Dismiss
                  </button>
                </div>
              </>
            )}
            <p id="ma-hint" className="ma-hint">
              Esc dismisses · ⌘J joins
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
