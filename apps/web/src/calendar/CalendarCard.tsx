import './calendar-card.css';
import { useId, useState, type ReactNode } from 'react';
import type {
  CalendarAccount,
  CalendarChoice,
  CalendarChoicePatch,
  CalendarStatus,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { CalendarAccounts } from './CalendarAccounts.tsx';
import { connectorLine, type TodayState } from './today-model.ts';
import { useCalendarActions, useCalendarStatus, useOpenCalendarSettings } from './use-calendar.ts';

export const AGENTS_READ_LABEL = 'Let agents read my calendar';

function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="gh-err" role="alert">
      {error.message}
    </p>
  );
}

function ConnectBody() {
  const { connect } = useCalendarActions();
  return (
    <div className="cx-body">
      <div className="cal-connect">
        <b>Connect macOS Calendar</b>
        <ol>
          <li>macOS asks to let Spark Outpost use your calendars.</li>
          <li>Pick which calendars to include. Event details stay on this Mac.</li>
          <li>Today, Upcoming and Spark Island start showing your day.</li>
        </ol>
      </div>
      <ErrorLine error={connect.error} />
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
    </div>
  );
}

function DeniedBody() {
  const open = useOpenCalendarSettings();
  return (
    <div className="cx-body">
      <p>
        <b>Spark Outpost can’t read your calendars.</b> Turn on Spark Outpost in System Settings →
        Privacy &amp; Security → Calendars, then come back; this card checks again when the window
        is in front.
      </p>
      <ErrorLine error={open.error} />
      <div className="cx-actions">
        <button type="button" className="btn primary sm" onClick={() => open.mutate()}>
          Open Calendar settings
        </button>
      </div>
    </div>
  );
}

function HelperBody() {
  return (
    <div className="cx-body">
      <p>
        <b>Spark Outpost can’t start its calendar helper.</b> From source, build it with{' '}
        <code>pnpm desktop:calendar</code>. In a release, reinstall Spark Outpost.
      </p>
    </div>
  );
}

function AgentsRead() {
  const id = useId();
  const hintId = useId();
  return (
    <SettingRow
      label={AGENTS_READ_LABEL}
      controlId={id}
      hint="Off. Agent tools for the calendar come in a later update."
      hintId={hintId}
      disabled
    >
      <BlobToggle
        id={id}
        label={AGENTS_READ_LABEL}
        checked={false}
        disabled
        describedBy={hintId}
        onChange={() => undefined}
      />
    </SettingRow>
  );
}

type Overrides = Readonly<Record<string, CalendarChoicePatch>>;

function withOverrides(
  accounts: readonly CalendarAccount[],
  overrides: Overrides,
): CalendarAccount[] {
  return accounts.map((account) => ({
    ...account,
    calendars: account.calendars.map(
      (calendar) => ({ ...calendar, ...overrides[calendar.key] }) as CalendarChoice,
    ),
  }));
}

function ConnectedBody({ status }: { status: CalendarStatus }) {
  const { choose, disconnect } = useCalendarActions();
  const [overrides, setOverrides] = useState<Overrides>({});
  const change = (key: string, patch: CalendarChoicePatch) => {
    setOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    choose.mutate(
      { key, patch },
      {
        onSettled: () =>
          setOverrides((current) =>
            Object.fromEntries(Object.entries(current).filter(([saved]) => saved !== key)),
          ),
      },
    );
  };
  return (
    <div className="cx-body">
      <p>
        Every account in System Settings → Internet Accounts, read on this Mac. Nudges come from
        calendars with Use for nudges on; Counts as busy shapes your free time.
      </p>
      {status.notice && (
        <p className="cal-notice" role="status">
          {status.notice}
        </p>
      )}
      <CalendarAccounts accounts={withOverrides(status.accounts, overrides)} onChange={change} />
      <ErrorLine error={choose.error} />
      <AgentsRead />
      <ErrorLine error={disconnect.error} />
      <div className="cx-actions">
        <button
          type="button"
          className="btn ghost sm danger"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function bodyFor(state: TodayState, status: CalendarStatus): ReactNode {
  if (state === 'helper') return <HelperBody />;
  if (state === 'denied') return <DeniedBody />;
  if (state === 'connect') return <ConnectBody />;
  return <ConnectedBody status={status} />;
}

interface CalendarCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function CalendarCard({ icon, open, onToggle }: CalendarCardProps) {
  const query = useCalendarStatus();
  const status = query.data;
  if (!status?.supported) return null;
  const line = connectorLine(status);
  const connected = line.state === 'ready' || line.state === 'none';
  return (
    <ConnectorCard
      connectorId="calendar"
      name="Calendar"
      icon={icon}
      status={line.text}
      badge={connected ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {bodyFor(line.state, status)}
    </ConnectorCard>
  );
}
