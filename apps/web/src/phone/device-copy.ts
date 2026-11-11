import {
  REMOTE_DEVICE_IDLE_DAYS,
  type PushTestResult,
  type RemoteDevice,
} from '@spark-outpost/contracts';
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

export function pushTestLine(result: PushTestResult, deviceName: string): string {
  switch (result.outcome) {
    case 'sent':
      return `Test notification sent to ${deviceName}. It should appear there in a few seconds.`;
    case 'off':
      return 'Turn on Notify when a chat needs you, then try again.';
    case 'none':
      return `${deviceName} hasn't turned on notifications. On that device, open Remote control and turn on Notify this device.`;
    case 'gone':
      return `${deviceName} is no longer registered for notifications. Turn on Notify this device there again.`;
    case 'failed':
      return result.reason === 'BadJwtToken'
        ? 'The push service did not accept the sender contact (BadJwtToken). Change Sender contact and try again.'
        : `The push service did not accept it${result.reason ? ` (${result.reason})` : ''}. Try again.`;
  }
}
