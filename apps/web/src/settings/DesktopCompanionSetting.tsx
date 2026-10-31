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
import type { DocTarget } from '../ui/DocLink.tsx';
import { Keys } from '../ui/Keys.tsx';
import { ISLAND_HEIGHT_LABEL, IslandHeightSetting } from './IslandHeightSetting.tsx';
import { ISLAND_SIZE_LABEL, IslandSizeSetting } from './IslandSizeSetting.tsx';
import { SettingRow } from './SettingRow.tsx';
import { SHOW_ISLAND_LABEL } from './setting-labels.ts';

const CHIMES = 'Island chimes';
const AUTO_EXPAND = 'Open requests by themselves';
const HIDE_IN_SHARE = 'Hide in screen sharing';
const NOTIFY = 'Dock badge and notifications';
const MENU_BAR = 'Show in menu bar';

function notifyHint(status: CompanionStatus): string {
  if (!status.notify) return 'Off. No Dock count, and no notification while Spark Island is off.';
  if (status.notifyBlocked)
    return 'macOS blocked the last notification. Allow Spark in System Settings → Notifications.';
  return 'The Dock icon counts chats that need you. With Spark Island off, a notification names the chat.';
}

const SHORTCUTS: { action: IslandAction; label: string; hint: string }[] = [
  { action: 'quick', label: 'Quick chat shortcut', hint: 'Opens a new chat from anywhere.' },
  { action: 'sessions', label: 'Inbox shortcut', hint: 'Opens the island inbox.' },
];

const DEFAULTS: Record<IslandAction, string> = { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' };

const SHOWN_WITH_ISLAND = [
  ISLAND_SIZE_LABEL,
  ISLAND_HEIGHT_LABEL,
  AUTO_EXPAND,
  HIDE_IN_SHARE,
  ...SHORTCUTS.map((shortcut) => shortcut.label),
  CHIMES,
];

export function islandRows(): string[] {
  if (!companionAvailable()) return [];
  return [
    SHOW_ISLAND_LABEL,
    NOTIFY,
    MENU_BAR,
    ISLAND_SIZE_LABEL,
    ISLAND_HEIGHT_LABEL,
    AUTO_EXPAND,
    HIDE_IN_SHARE,
    ...SHORTCUTS.map((shortcut) => shortcut.label),
    CHIMES,
  ];
}

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
  standsFor,
}: {
  id: string;
  label: string;
  doc: DocTarget;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  standsFor?: readonly string[] | undefined;
}) {
  const hintId = useId();
  return (
    <SettingRow
      label={label}
      controlId={id}
      doc={doc}
      hint={hint}
      hintId={hintId}
      standsFor={standsFor}
    >
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
  const shareId = useId();
  const notifyId = useId();
  const menuBarId = useId();
  if (!companionAvailable() || !status?.supported) return null;
  const desktop = sparkDesktop()!;
  return (
    <section className="spark-group" aria-labelledby="set-island">
      <h4 id="set-island">Spark Island</h4>
      <SwitchRow
        id={showId}
        label={SHOW_ISLAND_LABEL}
        doc={{ page: 'desktop-companion' }}
        hint={
          status.enabled
            ? 'Spark Island sits at the top of your screen and shows what needs you.'
            : 'Off. Turn it on to see Spark Island at the top of your screen.'
        }
        checked={status.enabled}
        standsFor={status.enabled ? undefined : SHOWN_WITH_ISLAND}
        onChange={(on) => void desktop.companion.setEnabled(on)}
      />
      {desktop.companion.setNotify && (
        <SwitchRow
          id={notifyId}
          label={NOTIFY}
          doc={{ page: 'desktop-companion', heading: 'when-spark-island-is-off' }}
          hint={notifyHint(status)}
          checked={status.notify === true}
          onChange={(on) => void desktop.companion.setNotify?.(on)}
        />
      )}
      {desktop.companion.setMenuBar && (
        <SwitchRow
          id={menuBarId}
          label={MENU_BAR}
          doc={{ page: 'desktop-companion', heading: 'turn-it-on-and-size-it' }}
          hint={
            status.menuBar
              ? 'A Spark icon in the menu bar opens Spark, shows or hides Spark Island, and quits.'
              : 'Off. Open Spark from the Dock; right-click its icon to show or hide Spark Island.'
          }
          checked={status.menuBar === true}
          onChange={(on) => void desktop.companion.setMenuBar?.(on)}
        />
      )}
      {status.enabled && (
        <>
          {desktop.companion.setIslandSize && (
            <IslandSizeSetting
              status={status}
              onChange={(size) => void desktop.companion.setIslandSize?.(size)}
            />
          )}
          <IslandHeightSetting
            status={status}
            onChange={desktop.companion.setIslandHeight}
            onPreview={desktop.companion.previewIslandHeight}
          />
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
          {desktop.companion.setHideInShare && (
            <SwitchRow
              id={shareId}
              label={HIDE_IN_SHARE}
              doc={{ page: 'desktop-companion', heading: 'turn-it-on-and-size-it' }}
              hint={
                status.hideInShare
                  ? 'Screen sharing and recordings leave Spark Island out where macOS allows it.'
                  : 'Off. Spark Island shows in screen sharing, recordings and screenshots.'
              }
              checked={status.hideInShare === true}
              onChange={(on) => void desktop.companion.setHideInShare?.(on)}
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
    </section>
  );
}
