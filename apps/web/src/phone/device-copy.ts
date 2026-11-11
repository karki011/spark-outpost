import { REMOTE_DEVICE_IDLE_DAYS, type RemoteDevice } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { passkeySummary, shortDate } from './phone-copy.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 5;

export function daysUntilUnused(
  device: Pick<RemoteDevice, 'lastSeenAt' | 'connected' | 'expired'>,
  now: number,
): number | null {
  if (device.connected || device.expired) return null;
  const left = new Date(device.lastSeenAt).getTime() + REMOTE_DEVICE_IDLE_DAYS * DAY_MS - now;
  if (left <= 0) return null;
  const days = Math.ceil(left / DAY_MS);
  return days <= WARN_DAYS ? days : null;
}

export function stopsWorkingLine(days: number): string {
  return `Stops working in ${countLabel(days, 'day')} unless used`;
}

export function lastSeenLine(device: RemoteDevice, now: number): string {
  const label = device.duplicateOf ? 'Not seen since' : 'Last seen';
  return `${label} ${relativeTime(device.lastSeenAt, now)}`;
}

export function deviceSummary(device: RemoteDevice): string {
  return [
    `Added ${shortDate(device.createdAt)}`,
    passkeySummary(device.passkeys) ?? 'No passkey',
  ].join(' · ');
}
