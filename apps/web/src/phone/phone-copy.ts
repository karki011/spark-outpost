import type { RemoteAuditEntry, RemotePasskey, TailscaleState } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';

export const PASSKEY_PURPOSE =
  'Lets this phone sign in again in another browser without going back to your Mac.';
export const PASSKEY_SAVE = 'Save a passkey for this phone';
export const PASSKEY_SAVED = 'Passkey saved. In another browser, choose Sign in with a passkey.';
export const PASSKEY_NOT_SAVED = 'No passkey was saved. Try again when you are ready.';
export const PASSKEY_EXISTS = 'This phone already has a passkey there.';
export const PASSKEY_UNSUPPORTED = 'This browser cannot save passkeys.';
export const PASSKEY_OFF = 'Passkey sign-in is turned off on your Mac.';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function passkeyName(passkey: RemotePasskey): string {
  return passkey.label ?? 'Passkey';
}

export function passkeySummary(passkeys: readonly RemotePasskey[]): string | null {
  const newest = passkeys.at(-1);
  if (!newest) return null;
  const names = [...new Set(passkeys.flatMap((passkey) => passkey.label ?? []))];
  const parts = [
    countLabel(passkeys.length, 'passkey'),
    ...(names.length > 0 ? [names.join(', ')] : []),
    `added ${shortDate(newest.createdAt)}`,
    ...(passkeys.some((passkey) => passkey.synced) ? ['synced to other devices'] : []),
  ];
  return parts.join(' · ');
}

export interface StatusCopy {
  title: string;
  step: string | null;
  link?: { label: string; href: string };
}

export function statusCopy(state: TailscaleState): StatusCopy {
  switch (state.status) {
    case 'not_installed':
      return {
        title: 'Tailscale is not installed',
        step: 'Install Tailscale on this Mac and on your phone, and sign in to both with the same account.',
        link: { label: 'Get Tailscale', href: 'https://tailscale.com/download' },
      };
    case 'signed_out':
      return {
        title: 'Tailscale is not signed in',
        step: 'Open Tailscale on this Mac, sign in and connect.',
      };
    case 'https_off':
      return {
        title: 'HTTPS certificates are off',
        step: 'In the Tailscale admin console, open DNS and turn on HTTPS Certificates.',
        link: { label: 'Open DNS settings', href: 'https://login.tailscale.com/admin/dns' },
      };
    case 'off':
      return {
        title: 'Phone access is off',
        step:
          state.message ??
          'Turn it on to reach Spark Outpost from devices on your own tailnet. Nothing is public.',
      };
    case 'on':
      return { title: 'Phone access is on', step: null };
    case 'error':
      return { title: 'Phone access needs a look', step: state.message };
  }
}

function named(entry: RemoteAuditEntry): string {
  const fromDetail = entry.detail.deviceName;
  return entry.deviceName ?? (typeof fromDetail === 'string' ? fromDetail : 'A phone');
}

function pairingPageLine(entry: RemoteAuditEntry): string {
  switch (entry.detail.reason) {
    case 'revoked':
      return `${named(entry)} asked to pair again (it was removed on this Mac)`;
    case 'unused':
      return `${named(entry)} asked to pair again (not used for 30 days)`;
    case 'unknown':
      return 'A phone that was paired before asked to pair again (this Mac does not know its sign-in)';
    default:
      return 'A phone with no sign-in opened the pairing page';
  }
}

function passkeyRefusedLine(entry: RemoteAuditEntry): string {
  if (!entry.deviceName) return 'A passkey sign-in was refused';
  const unused = entry.detail.reason === 'device_unused' ? ' (not used for 30 days)' : '';
  return `A passkey sign-in for ${entry.deviceName} was refused${unused}`;
}

function passkeySignInLine(entry: RemoteAuditEntry): string {
  const line = `${named(entry)} signed in with a passkey`;
  return entry.detail.counter === 'regressed'
    ? `${line}. Its use count went backwards: remove its passkeys if this was not you`
    : line;
}

export function activityLine(entry: RemoteAuditEntry): string {
  const device = named(entry);
  switch (entry.action) {
    case 'hostname_changed':
      return entry.detail.on === true ? 'Phone access turned on' : 'Phone access turned off';
    case 'switches_changed':
      return 'What the phone can do was changed';
    case 'pairing_started':
      return 'Pairing started on this Mac';
    case 'pairing_submitted':
      return `${device} asked to pair`;
    case 'pairing_failed':
      return 'A pairing code was refused';
    case 'pairing_confirmed':
      return `Pairing confirmed for ${device}`;
    case 'pairing_denied':
      return `Pairing denied for ${device}`;
    case 'device_paired':
      return `${device} paired`;
    case 'device_paired_again':
      return `${device} paired again`;
    case 'pairing_page_shown':
      return pairingPageLine(entry);
    case 'device_renamed':
      return `Device renamed to ${device}`;
    case 'device_revoked':
      return `${device} revoked`;
    case 'devices_disconnected':
      return 'All devices disconnected';
    case 'device_passkey_added':
      return `${device} saved a passkey`;
    case 'device_passkey_sign_in':
      return passkeySignInLine(entry);
    case 'device_passkeys_removed':
      return `Passkeys removed for ${device}`;
    case 'passkey_sign_in_failed':
      return passkeyRefusedLine(entry);
    case 'request':
      return `${device} made a change`;
    case 'refused':
      return `${device} was refused`;
  }
}

export function activityDetail(entry: RemoteAuditEntry): string | null {
  if (!entry.method || !entry.path) return null;
  const status = entry.status === null ? '' : ` · ${entry.status}`;
  return `${entry.method} ${entry.path}${status}`;
}
