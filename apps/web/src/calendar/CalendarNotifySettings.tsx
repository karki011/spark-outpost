import { useId, useState } from 'react';
import type { CalendarSettings, CalendarSettingsPatch } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { parseFocusNames } from './focus-names.ts';
import { useCalendarActions, useCalendarStatus } from './use-calendar.ts';

export const CALENDAR_BRIEF_LABEL = 'Add today’s calendar to the brief';
const BEFORE_LABEL = 'Before a meeting';
const WRAP_UP_LABEL = 'Wrap-up reminder';
const CAPTURE_LABEL = 'Anything to capture?';
const HOLD_LABEL = 'Hold chimes during';
const FOCUS_NAMES_LABEL = 'Focus blocks are events named';
const PHONE_LABEL = 'Meeting alerts on paired devices';

export const CALENDAR_NOTIFY_ROWS = [
  BEFORE_LABEL,
  WRAP_UP_LABEL,
  CAPTURE_LABEL,
  HOLD_LABEL,
  FOCUS_NAMES_LABEL,
  PHONE_LABEL,
] as const;

const BEFORE = [
  { id: '5', label: '5 min' },
  { id: '10', label: '10 min' },
  { id: '15', label: '15 min' },
];
const WRAP_UP = [
  { id: '0', label: 'Off' },
  { id: '15', label: '15 min' },
  { id: '30', label: '30 min' },
];
const HOLD = [
  { id: 'never', label: 'Never' },
  { id: 'focus', label: 'Focus blocks' },
  { id: 'meetings', label: 'All meetings' },
];

type Save = (patch: CalendarSettingsPatch) => void;

function useCalendarSettings(): {
  settings: CalendarSettings;
  save: Save;
  error: string | null;
} | null {
  const status = useCalendarStatus();
  const { settings } = useCalendarActions();
  if (!status.data?.supported) return null;
  const pending = settings.isPending ? settings.variables : null;
  return {
    settings: { ...status.data.settings, ...pending } as CalendarSettings,
    save: (patch) => settings.mutate(patch),
    error: settings.error?.message ?? null,
  };
}

function SwitchRow(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <SettingRow label={props.label} controlId={id} hint={props.hint} hintId={hintId}>
      <BlobToggle
        id={id}
        label={props.label}
        checked={props.checked}
        describedBy={hintId}
        onChange={props.onChange}
      />
    </SettingRow>
  );
}

function ChoiceRow(props: {
  label: string;
  hint: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const hintId = useId();
  return (
    <SettingRow label={props.label} hint={props.hint} hintId={hintId}>
      <Segmented
        ariaLabel={props.label}
        describedBy={hintId}
        options={props.options}
        value={props.value}
        onChange={(id) => props.onChange(id)}
      />
    </SettingRow>
  );
}

export function CalendarBriefSetting() {
  const calendar = useCalendarSettings();
  if (!calendar) return null;
  return (
    <SwitchRow
      label={CALENDAR_BRIEF_LABEL}
      hint="Drawn on this Mac beside the brief, never in its prompt."
      checked={calendar.settings.briefBlock}
      onChange={(on) => calendar.save({ briefBlock: on })}
    />
  );
}

function FocusNames({ names, save }: { names: readonly string[]; save: Save }) {
  const id = useId();
  const hintId = useId();
  const saved = names.join(', ');
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const parsed = parseFocusNames(draft);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setDraft(parsed.names.join(', '));
    if (parsed.names.join(', ') !== saved) save({ focusNames: parsed.names });
  };
  return (
    <SettingRow
      label={FOCUS_NAMES_LABEL}
      controlId={id}
      hint={problem ?? 'Separate names with commas. Case does not matter.'}
      hintId={hintId}
    >
      <input
        id={id}
        className="inp"
        value={draft}
        aria-describedby={hintId}
        aria-invalid={problem !== null || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </SettingRow>
  );
}

export function CalendarMeetingSettings() {
  const calendar = useCalendarSettings();
  if (!calendar) return null;
  const { settings, save } = calendar;
  return (
    <>
      <section className="spark-group" aria-labelledby="notify-meetings">
        <h4 id="notify-meetings">Meetings</h4>
        <ChoiceRow
          label={BEFORE_LABEL}
          hint="A Spark Island line with what needs you, and Join from 5 min before."
          options={BEFORE}
          value={String(settings.beforeMinutes)}
          onChange={(id) =>
            save({ beforeMinutes: Number(id) as CalendarSettings['beforeMinutes'] })
          }
        />
        <ChoiceRow
          label={WRAP_UP_LABEL}
          hint="Names a chat that is still running or needs you before a meeting."
          options={WRAP_UP}
          value={String(settings.wrapUpMinutes)}
          onChange={(id) =>
            save({ wrapUpMinutes: Number(id) as CalendarSettings['wrapUpMinutes'] })
          }
        />
        <SwitchRow
          label={CAPTURE_LABEL}
          hint="One Spark Island line when a meeting with notes ends."
          checked={settings.capture}
          onChange={(on) => save({ capture: on })}
        />
      </section>
      <section className="spark-group" aria-labelledby="notify-holds">
        <h4 id="notify-holds">Island chimes and phone</h4>
        <ChoiceRow
          label={HOLD_LABEL}
          hint="Held chimes show as one catch-up line afterwards. Cards still appear, silently."
          options={HOLD}
          value={settings.holdRule}
          onChange={(id) => save({ holdRule: id as CalendarSettings['holdRule'] })}
        />
        <FocusNames key={settings.focusNames.join('|')} names={settings.focusNames} save={save} />
        <SwitchRow
          label={PHONE_LABEL}
          hint={`Only “Meeting in ${settings.beforeMinutes} min”: no title or Join, and held during focus like chimes. Needs Notify when a chat needs you on Remote control.`}
          checked={settings.phoneAlerts}
          onChange={(on) => save({ phoneAlerts: on })}
        />
        {calendar.error && (
          <p className="home-error" role="alert">
            {calendar.error}
          </p>
        )}
      </section>
    </>
  );
}
