import { appLock, useAppLock } from '../app-lock/use-app-lock.ts';
import { requestSettings } from '../settings/settings-request.ts';
import { LOCK_PATH } from '../ui/icons.tsx';
import { keysText } from '../ui/Keys.tsx';

const LABEL = 'Lock Spark Outpost';
const SET_UP = 'Set up the privacy screen';

export function RailLock() {
  const lock = appLock();
  const status = useAppLock();
  if (!lock || !status) return null;
  const ready = status.enabled && status.hasCode;
  return (
    <button
      type="button"
      className="rail-btn rail-lock"
      aria-label={LABEL}
      aria-keyshortcuts={ready ? 'Shift+Meta+L' : undefined}
      title={ready ? `${LABEL} · ${keysText(['⇧', '⌘', 'L'])}` : SET_UP}
      onClick={() => {
        if (ready) void lock.lockNow();
        else requestSettings('lock');
      }}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={LOCK_PATH} />
      </svg>
    </button>
  );
}
