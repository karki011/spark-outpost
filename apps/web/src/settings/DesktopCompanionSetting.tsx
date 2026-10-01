import { useId, useState, type KeyboardEvent } from 'react';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import {
  companionAvailable,
  sparkDesktop,
  type CompanionStatus,
  type IslandAction,
} from '../desktop/desktop-bridge.ts';
import { acceleratorFromKey, shortcutKeys } from '../desktop/shortcut-keys.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import { Keys } from '../ui/Keys.tsx';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Show companion on desktop';

const SHORTCUTS: { action: IslandAction; label: string; hint: string }[] = [
  { action: 'quick', label: 'Quick chat shortcut', hint: 'Opens a new chat from anywhere.' },
  { action: 'sessions', label: 'Sessions shortcut', hint: 'Finds a chat and asks for an update.' },
];

const DEFAULTS: Record<IslandAction, string> = { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' };

function ShortcutSetting({
  action,
  label,
  hint,
  status,
}: {
  action: IslandAction;
  label: string;
  hint: string;
  status: CompanionStatus;
}) {
  const hintId = useId();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accelerator = status.shortcuts[action];
  const failed = status.failed.includes(action);

  const save = async (next: string | null) => {
    const result = await sparkDesktop()!.companion.setShortcut(action, next);
    setError(result.ok ? null : result.error);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    const next = acceleratorFromKey(event);
    if (!next) return;
    setRecording(false);
    void save(next);
  };

  const shown =
    error ??
    (failed
      ? 'Another app is using this shortcut. Pick a different one.'
      : recording
        ? 'Press the new keys, or Escape to cancel.'
        : hint);
  return (
    <SettingRow label={label} hint={shown} hintId={hintId}>
      <span className="desk-shortcut">
        <Keys keys={shortcutKeys(accelerator)} />
        <button
          type="button"
          className="btn line sm"
          aria-describedby={hintId}
          aria-label={recording ? `Recording ${label}` : `Change ${label}`}
          onClick={() => setRecording(!recording)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording ? 'Press keys…' : 'Change'}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={accelerator === DEFAULTS[action]}
          onClick={() => void save(null)}
          aria-label={`Reset ${label}`}
        >
          Reset
        </button>
      </span>
    </SettingRow>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <SettingRow label={label} controlId={id} hint={hint} hintId={hintId}>
      <BlobToggle
        id={id}
        label={label}
        kind="spark"
        checked={checked}
        describedBy={hintId}
        onChange={onChange}
      />
    </SettingRow>
  );
}

export function DesktopCompanionSetting() {
  const status = useCompanionStatus();
  if (!companionAvailable() || !status?.supported) return null;
  const desktop = sparkDesktop()!;
  return (
    <>
      <SwitchRow
        label={LABEL}
        hint={
          status.enabled
            ? 'Scout sits at the top of your screen, under the notch, and shows what needs you.'
            : 'Off. Turn it on to see Spark at the top of your screen.'
        }
        checked={status.enabled}
        onChange={(on) => void desktop.companion.setEnabled(on)}
      />
      {status.enabled && (
        <>
          {SHORTCUTS.map((shortcut) => (
            <ShortcutSetting key={shortcut.action} {...shortcut} status={status} />
          ))}
          <SwitchRow
            label="Calm mode"
            hint="Keeps the blobs still apart from what matters: no hops, waves or sparkles."
            checked={status.calm}
            onChange={(on) => void desktop.companion.setCalm(on)}
          />
        </>
      )}
    </>
  );
}
