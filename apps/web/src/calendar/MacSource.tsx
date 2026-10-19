import type { CalendarAccount, CalendarStatus } from '@spark-outpost/contracts';
import { CheckIcon, LaptopIcon } from '../ui/icons.tsx';
import { CalendarAccounts, type ChangeChoice } from './CalendarAccounts.tsx';
import { SourceCard } from './SourceCard.tsx';
import { macState } from './today-model.ts';
import { useCalendarActions, useOpenCalendarSettings } from './use-calendar.ts';

export const MAC_CALENDAR = 'Mac Calendar';

export const MAC_DISCONNECT = {
  title: `Disconnect ${MAC_CALENDAR}?`,
  text: 'Spark stops showing its meetings and nudges. Nothing in Calendar changes, and Spark Outpost keeps its Calendars access in System Settings. You can connect it again any time.',
};

export const EDIT_HINT =
  'Agents change events only on calendars switched on here. Events with guests and shared calendars always ask; deletes follow the agent’s mode.';

export function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="gh-err" role="alert">
      {error.message}
    </p>
  );
}

export function ConnectedPill() {
  return (
    <span className="pill-ok">
      <CheckIcon />
      Connected
    </span>
  );
}

export function DeniedBody() {
  const open = useOpenCalendarSettings();
  return (
    <>
      <p className="cal-muted">
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

export function HelperBody() {
  return (
    <p className="cal-muted">
      <b>Spark Outpost can’t start its calendar helper.</b> From source, build it with{' '}
      <code>pnpm desktop:calendar</code>. In a release, reinstall Spark Outpost.
    </p>
  );
}

interface MacSourceProps {
  status: CalendarStatus;
  accounts: readonly CalendarAccount[];
  onChange: ChangeChoice;
}

function MacPill({ state }: { state: ReturnType<typeof macState> }) {
  if (state === 'ready') return <ConnectedPill />;
  return (
    <span className="cal-pill warn">{state === 'helper' ? 'Helper missing' : 'Access off'}</span>
  );
}

export function MacSource({ status, accounts, onChange }: MacSourceProps) {
  const { disconnect } = useCalendarActions();
  const state = macState(status);
  const calendars = accounts.flatMap((account) => account.calendars);
  const ready = state === 'ready' && calendars.length > 0;
  return (
    <SourceCard
      name={MAC_CALENDAR}
      icon={<LaptopIcon />}
      sync={state === 'ready' ? 'Follows Calendar on this Mac' : null}
      pill={<MacPill state={state} />}
      hasCalendars={ready}
      startChoosing={calendars.every((calendar) => !calendar.include)}
      editHint={EDIT_HINT}
      disconnect={MAC_DISCONNECT}
      busy={disconnect.isPending}
      onDisconnect={() => disconnect.mutate()}
      rows={(view) => <CalendarAccounts accounts={accounts} onChange={onChange} view={view} />}
    >
      {status.notice && (
        <p className="cal-notice" role="status">
          {status.notice}
        </p>
      )}
      {state === 'denied' && <DeniedBody />}
      {state === 'helper' && <HelperBody />}
      <ErrorLine error={disconnect.error} />
    </SourceCard>
  );
}
