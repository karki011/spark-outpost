import { LockButton } from '../app-lock/LockButton.tsx';
import { LOCK_PATH } from '../ui/icons.tsx';

export const RAIL_LOCK_ICON = (
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
);

export function RailLock() {
  return <LockButton className="rail-btn rail-lock">{RAIL_LOCK_ICON}</LockButton>;
}
