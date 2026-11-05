import './calendar-card.css';
import './calendar-connector.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GOOGLE_TESTING_LINE, type CalendarStatus } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { CloudIcon, LaptopIcon, LockIcon } from '../ui/icons.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { AddCalendar } from './AddCalendar.tsx';
import {
  GOOGLE_CALENDAR,
  GoogleSignInStatus,
  GoogleSource,
  SIGN_IN_WITH_GOOGLE,
} from './GoogleSource.tsx';
import { DeniedBody, ErrorLine, HelperBody, MAC_CALENDAR, MacSource } from './MacSource.tsx';
import { RefreshCalendar } from './RefreshCalendar.tsx';
import { connectorLine, hasCalendarSource, macState, nextMeeting } from './today-model.ts';
import { useCalendarChoices } from './use-calendar-choices.ts';
import { useCalendarActions, useCalendarNow, useCalendarStatus } from './use-calendar.ts';
import { useGoogleCalendar, type GoogleCalendar } from './use-google-calendar.ts';

export const AGENTS_READ_LABEL = 'Let agents read my calendar';

export const AGENTS_READ_HINT =
  'Agents in your chats can list events and free time. Each chat asks once unless its mode runs Spark actions at once. Agents change events only on calendars with Agents can edit on.';

export const CALENDAR_PRIVACY_LINE =
  'Read-only by default. Spark keeps events on this Mac: agents read them only with Let agents read my calendar on, and change them only on calendars with Agents can edit on.';

const STATUS_REFRESH_MS = 60_000;

function AgentsRead({ on }: { on: boolean }) {
  const id = useId();
  const hintId = useId();
  const { settings } = useCalendarActions();
  const [shown, setShown] = useState<boolean | null>(null);
  const checked = shown ?? on;
  const change = (agentsRead: boolean) => {
    setShown(agentsRead);
    settings.mutate({ agentsRead }, { onSettled: () => setShown(null) });
  };
  return (
    <>
      <SettingRow label={AGENTS_READ_LABEL} controlId={id} hint={AGENTS_READ_HINT} hintId={hintId}>
        <BlobToggle
          id={id}
          label={AGENTS_READ_LABEL}
          checked={checked}
          describedBy={hintId}
          onChange={change}
        />
      </SettingRow>
      <ErrorLine error={settings.error} />
    </>
  );
}

function PrivacyLine() {
  return (
    <p className="cal-privacy">
      <LockIcon />
      <span>{CALENDAR_PRIVACY_LINE}</span>
    </p>
  );
}

interface TileProps {
  icon: ReactNode;
  title: string;
  text: string;
  children: ReactNode;
}

function Tile({ icon, title, text, children }: TileProps) {
  const titleId = useId();
  return (
    <section className="cal-tile" aria-labelledby={titleId}>
      <span className="cal-source-icon" aria-hidden="true">
        {icon}
      </span>
      <h3 id={titleId}>{title}</h3>
      <p className="cal-muted">{text}</p>
      {children}
    </section>
  );
}

function MacTile({ status }: { status: CalendarStatus }) {
  const { connect } = useCalendarActions();
  const state = macState(status);
  return (
    <Tile
      icon={<LaptopIcon />}
      title={MAC_CALENDAR}
      text="Every calendar already on this Mac: iCloud, Exchange, Google."
    >
      {state === 'denied' && <DeniedBody />}
      {state === 'helper' && <HelperBody />}
      {state === 'connect' && (
        <div className="cx-actions">
          <button
            type="button"
            className="btn primary sm"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {connect.isPending ? 'Waiting for macOS…' : 'Connect'}
          </button>
        </div>
      )}
      <ErrorLine error={connect.error} />
    </Tile>
  );
}

function GoogleTile({ status, google }: { status: CalendarStatus; google: GoogleCalendar }) {
  return (
    <Tile
      icon={<CloudIcon />}
      title={GOOGLE_CALENDAR}
      text="Sign in with Google. Works without the Mac Calendar app."
    >
      {status.google.testing && <p className="cal-muted">{GOOGLE_TESTING_LINE}</p>}
      {!google.waiting && (
        <div className="cx-actions">
          <button
            type="button"
            className="btn line sm"
            disabled={google.starting}
            onClick={() => google.begin({ accountId: null, editCalendar: null })}
          >
            {SIGN_IN_WITH_GOOGLE}
          </button>
        </div>
      )}
      <RefreshCalendar />
      <GoogleSignInStatus google={google} />
    </Tile>
  );
}

function EmptyBody({ status, google }: { status: CalendarStatus; google: GoogleCalendar }) {
  return (
    <div className="cal-tiles">
      <MacTile status={status} />
      {status.google.available && <GoogleTile status={status} google={google} />}
    </div>
  );
}

function useFocusWhenSourceLeaves(count: number) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const before = useRef(count);
  useEffect(() => {
    const body = bodyRef.current;
    const left = count < before.current;
    before.current = count;
    if (!left || !body || body.contains(document.activeElement)) return;
    body.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [count]);
  return bodyRef;
}

function ConnectedBody({ status, google }: { status: CalendarStatus; google: GoogleCalendar }) {
  const { mac, google: googleAccounts, change, error } = useCalendarChoices(status.accounts);
  const { connect } = useCalendarActions();
  const state = macState(status);
  const macRefused = !status.connected && connect.isSuccess && state === 'denied';
  const canAddMac = !status.connected && state !== 'helper';
  return (
    <>
      {status.connected && <MacSource status={status} accounts={mac} onChange={change} />}
      {macRefused && <DeniedBody />}
      {status.google.accounts.map((account) => (
        <GoogleSource
          key={account.id}
          account={account}
          calendars={googleAccounts.find((item) => item.id === `google:${account.id}`)}
          google={google}
          onChange={change}
        />
      ))}
      <div className="cal-add-row">
        {status.google.available && status.google.testing && (
          <p className="cal-muted">{GOOGLE_TESTING_LINE}</p>
        )}
        <AddCalendar
          onMac={canAddMac ? () => connect.mutate() : null}
          onGoogle={
            status.google.available
              ? () => google.begin({ accountId: null, editCalendar: null })
              : null
          }
          disabled={connect.isPending || google.starting || google.waiting}
        />
      </div>
      <GoogleSignInStatus google={google} />
      <ErrorLine error={error ?? connect.error} />
      <AgentsRead on={status.settings.agentsRead} />
    </>
  );
}

function CardBody({ status }: { status: CalendarStatus }) {
  useCalendarStatus(STATUS_REFRESH_MS);
  const google = useGoogleCalendar(status.google);
  const sources = (status.connected ? 1 : 0) + status.google.accounts.length;
  const bodyRef = useFocusWhenSourceLeaves(sources);
  return (
    <div ref={bodyRef} className="cx-body cal-body">
      {hasCalendarSource(status) ? (
        <ConnectedBody status={status} google={google} />
      ) : (
        <EmptyBody status={status} google={google} />
      )}
      <PrivacyLine />
    </div>
  );
}

interface CalendarCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function CalendarCard({ icon, open, onToggle }: CalendarCardProps) {
  const status = useCalendarStatus().data;
  const connected = status ? hasCalendarSource(status) : false;
  const upcoming = useCalendarNow(connected).data?.upcoming;
  const now = useMinuteClock();
  if (!status?.supported) return null;
  const line = connectorLine(status, nextMeeting(upcoming, now), now);
  const ready = line.state === 'ready' || line.state === 'none';
  return (
    <ConnectorCard
      connectorId="calendar"
      name="Calendar"
      icon={icon}
      status={line.text}
      badge={ready ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      <CardBody status={status} />
    </ConnectorCard>
  );
}
