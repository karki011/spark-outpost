import { useId, useState } from 'react';
import { onWindows, type AppLockIdleMinutes } from '../desktop/desktop-bridge.ts';
import { hostWords } from '../desktop/host-words.ts';
import { shortcutText } from '../ui/shortcuts.ts';
import { CODE_RESET_NOTE, useCodeResetNote } from '../app-lock/lock-recovery.ts';
import { updateAppLock, useAppLock } from '../app-lock/use-app-lock.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import type { DocTarget } from '../ui/DocLink.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { LockCodeSheet } from './LockCodeSheet.tsx';
import { SettingRow } from './SettingRow.tsx';
import { SwitchRow } from './SwitchRow.tsx';

const LOCK_AWAY = 'Lock Spark when I’m away';
const LOCK_AFTER = 'Lock after';
const TOUCH_ID = 'Unlock with Touch ID';
const HIDE_NOTIFICATIONS = 'Hide notification text while locked';
const CODE = 'Code';

function lockOnSleepLabel(): string {
  return `Lock when the ${hostWords().computer} sleeps or its screen locks`;
}

function shownWhenOn(): string[] {
  const touchId = onWindows() ? [] : [TOUCH_ID];
  return [LOCK_AFTER, lockOnSleepLabel(), ...touchId, HIDE_NOTIFICATIONS];
}

export function privacyScreenRows(): string[] {
  return [LOCK_AWAY, ...shownWhenOn(), CODE];
}

function lockMenuHint(): string {
  const keys = shortcutText(['shift', 'mod', 'L']);
  const menu = onWindows() ? 'File' : 'Spark Outpost';
  return `Locks after the time below, or from ${menu} → Lock Spark Outpost (${keys}).`;
}

const DOC: DocTarget = { page: 'privacy-screen' };

const IDLE_CHOICES: { id: string; label: string; value: AppLockIdleMinutes }[] = [
  { id: '1', label: '1 min', value: 1 },
  { id: '5', label: '5 min', value: 5 },
  { id: '15', label: '15 min', value: 15 },
  { id: '30', label: '30 min', value: 30 },
];

type Sheet = 'set' | 'change' | null;

export function PrivacyScreenSection() {
  const status = useAppLock();
  const phone = useRemoteClient();
  const [sheet, setSheet] = useState<Sheet>(null);
  const resetNote = useCodeResetNote();
  const awayId = useId();
  const sleepId = useId();
  const touchId = useId();
  const hideId = useId();
  const afterHintId = useId();
  const codeHintId = useId();
  if (!status || phone.remote) return null;
  const { computer } = hostWords();

  const turn = (on: boolean) => {
    if (on && !status.hasCode) setSheet('set');
    else void updateAppLock({ enabled: on });
  };

  return (
    <>
      <p className="lede">
        Covers Spark’s windows until you unlock. Work in progress keeps running. It doesn’t lock
        your {computer}.
      </p>
      {resetNote.shown && !status.hasCode && (
        <p className="set-off-note" role="note">
          {CODE_RESET_NOTE}
        </p>
      )}
      <SwitchRow
        id={awayId}
        label={LOCK_AWAY}
        doc={DOC}
        hint={
          status.enabled
            ? lockMenuHint()
            : 'Off. Turning it on asks you to set a 6-digit code first.'
        }
        checked={status.enabled}
        standsFor={status.enabled ? undefined : shownWhenOn()}
        onChange={turn}
      />
      {status.enabled && (
        <>
          <SettingRow
            label={LOCK_AFTER}
            doc={DOC}
            hint={`No mouse or keys on this ${computer}`}
            hintId={afterHintId}
          >
            <Segmented
              ariaLabel={LOCK_AFTER}
              describedBy={afterHintId}
              options={IDLE_CHOICES}
              value={String(status.idleMinutes)}
              onChange={(id) => {
                const choice = IDLE_CHOICES.find((entry) => entry.id === id);
                if (choice) void updateAppLock({ idleMinutes: choice.value });
              }}
            />
          </SettingRow>
          <SwitchRow
            id={sleepId}
            label={lockOnSleepLabel()}
            doc={DOC}
            hint={
              status.onSleep
                ? 'Spark is locked when you come back.'
                : 'Off. Only the time above locks Spark.'
            }
            checked={status.onSleep}
            onChange={(on) => void updateAppLock({ onSleep: on })}
          />
          {!onWindows() && (
            <SwitchRow
              id={touchId}
              label={TOUCH_ID}
              doc={DOC}
              hint={
                status.touchIdAvailable ? 'Your code always works too' : 'This Mac has no Touch ID'
              }
              checked={status.touchId && status.touchIdAvailable}
              disabled={!status.touchIdAvailable}
              onChange={(on) => void updateAppLock({ touchId: on })}
            />
          )}
          <SwitchRow
            id={hideId}
            label={HIDE_NOTIFICATIONS}
            doc={DOC}
            hint="Shows “A chat needs you” with no chat name"
            checked={status.hideNotifications}
            onChange={(on) => void updateAppLock({ hideNotifications: on })}
          />
        </>
      )}
      {status.hasCode && (
        <SettingRow
          label={CODE}
          doc={DOC}
          hint={`Six digits, kept as a salted hash on this ${computer}.`}
          hintId={codeHintId}
        >
          <button
            type="button"
            className="btn sm line"
            aria-describedby={codeHintId}
            onClick={() => setSheet('change')}
          >
            Change code…
          </button>
        </SettingRow>
      )}
      {sheet && (
        <LockCodeSheet
          change={sheet === 'change'}
          onSaved={() => {
            resetNote.dismiss();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
