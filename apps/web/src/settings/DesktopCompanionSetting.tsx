import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import {
  companionAvailable,
  sparkDesktop,
  type CompanionStatus,
  type IslandAction,
} from '../desktop/desktop-bridge.ts';
import { acceleratorFromKey, shortcutKeys } from '../desktop/shortcut-keys.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import type { DocTarget } from '../ui/DocLink.tsx';
import { Keys } from '../ui/Keys.tsx';
import { IslandSizeSetting } from './IslandSizeSetting.tsx';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Show Spark Island';
const CHIMES = 'Island chimes';
const AUTO_EXPAND = 'Open requests by themselves';

let revealPending = false;
const revealers = new Set<() => void>();

export function revealIslandSettings(): void {
  revealPending = true;
  revealers.forEach((reveal) => reveal());
}

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
    <SettingRow
      label={label}
      doc={{ page: 'companion-quick-chat', heading: 'change-a-shortcut' }}
      hint={shown}
      hintId={hintId}
    >
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
  id,
  label,
  doc,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  doc: DocTarget;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const hintId = useId();
  return (
    <SettingRow label={label} controlId={id} doc={doc} hint={hint} hintId={hintId}>
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
  const showId = useId();
  const chimesId = useId();
  const expandId = useId();
  const loaded = status !== null;
  useEffect(() => {
    if (!loaded) return;
    const reveal = () => {
      const toggle = document.getElementById(showId);
      if (!revealPending || !toggle) return;
      revealPending = false;
      toggle.scrollIntoView({ block: 'center' });
      toggle.focus({ preventScroll: true });
    };
    revealers.add(reveal);
    reveal();
    return () => {
      revealers.delete(reveal);
    };
  }, [loaded, showId]);
  if (!companionAvailable() || !status?.supported) return null;
  const desktop = sparkDesktop()!;
  return (
    <>
      <SwitchRow
        id={showId}
        label={LABEL}
        doc={{ page: 'desktop-companion' }}
        hint={
          status.enabled
            ? 'Spark Island sits at the top of your screen and shows what needs you.'
            : 'Off. Turn it on to see Spark Island at the top of your screen.'
        }
        checked={status.enabled}
        onChange={(on) => void desktop.companion.setEnabled(on)}
      />
      {status.enabled && (
        <>
          {desktop.companion.setIslandSize && (
            <IslandSizeSetting
              status={status}
              onChange={(size) => void desktop.companion.setIslandSize?.(size)}
            />
          )}
          {desktop.companion.setAutoExpand && (
            <SwitchRow
              id={expandId}
              label={AUTO_EXPAND}
              doc={{ page: 'desktop-companion', heading: 'answer-a-card' }}
              hint={
                status.autoExpand
                  ? 'When a chat needs you, Spark Island opens the request once. It never takes the keyboard.'
                  : 'Off. A chat that needs you marks the blobs; hover or select one to open the request.'
              }
              checked={status.autoExpand === true}
              onChange={(on) => void desktop.companion.setAutoExpand?.(on)}
            />
          )}
          {SHORTCUTS.map((shortcut) => (
            <ShortcutSetting key={shortcut.action} {...shortcut} status={status} />
          ))}
          {desktop.companion.setSound && (
            <SwitchRow
              id={chimesId}
              label={CHIMES}
              doc={{ page: 'desktop-companion' }}
              hint={
                status.sound
                  ? 'Spark Island plays a soft chime when a chat needs you or finishes.'
                  : 'Off. Spark Island stays silent.'
              }
              checked={status.sound === true}
              onChange={(on) => void desktop.companion.setSound?.(on)}
            />
          )}
        </>
      )}
    </>
  );
}
