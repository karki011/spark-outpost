import './calendar-card.css';
import { useId, useState, type ReactNode } from 'react';
import type { CalendarAccount, CalendarStatus } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { CalendarAccounts, type ChangeChoice } from './CalendarAccounts.tsx';
import { GoogleAccounts } from './GoogleAccounts.tsx';
import { connectorLine, macState } from './today-model.ts';
import { useCalendarChoices } from './use-calendar-choices.ts';
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
    <>
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
    </>
  );
}

function DeniedBody() {
  const open = useOpenCalendarSettings();
  return (
    <>
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
    </>
  );
}

function HelperBody() {
  return (
    <p>
      <b>Spark Outpost can’t start its calendar helper.</b> From source, build it with{' '}
      <code>pnpm desktop:calendar</code>. In a release, reinstall Spark Outpost.
    </p>
  );
}

export const AGENTS_READ_HINT =
  'Agents in your chats can list events and free time. Each chat asks once unless its mode runs Spark actions at once. Agents change events only on calendars with Agents can edit on.';

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

interface MacProps {
  status: CalendarStatus;
  accounts: readonly CalendarAccount[];
  onChange: ChangeChoice;
}

function MacConnected({ status, accounts, onChange }: MacProps) {
  const { disconnect } = useCalendarActions();
  return (
    <>
      {status.notice && (
        <p className="cal-notice" role="status">
          {status.notice}
        </p>
      )}
      <CalendarAccounts accounts={accounts} onChange={onChange} withEdit />
      <ErrorLine error={disconnect.error} />
      <div className="cal-foot">
        <button
          type="button"
          className="btn ghost sm danger"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          Disconnect macOS Calendar
        </button>
      </div>
    </>
  );
}

function MacSection(props: MacProps) {
  const state = macState(props.status);
  return (
    <section className="cal-source" aria-labelledby="cal-mac-h">
      <div className="cal-src-h">
        <h3 id="cal-mac-h">macOS Calendar</h3>
        <small>Internet Accounts on this Mac</small>
      </div>
      {state === 'helper' && <HelperBody />}
      {state === 'denied' && <DeniedBody />}
      {state === 'connect' && <ConnectBody />}
      {state === 'ready' && <MacConnected {...props} />}
    </section>
  );
}

function CardBody({ status, connected }: { status: CalendarStatus; connected: boolean }) {
  const { mac, google, change, error } = useCalendarChoices(status.accounts);
  return (
    <div className="cx-body cal-body">
      <MacSection status={status} accounts={mac} onChange={change} />
      <GoogleAccounts status={status} accounts={google} onChange={change} />
      <ErrorLine error={error} />
      {connected && <AgentsRead on={status.settings.agentsRead} />}
    </div>
  );
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
      <CardBody status={status} connected={connected} />
    </ConnectorCard>
  );
}
