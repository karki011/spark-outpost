import type { RemoteAuditEntry, TailscaleState } from '@spark-outpost/contracts';

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
