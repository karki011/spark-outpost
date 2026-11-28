export type RemoteTab = 'setup' | 'devices' | 'permissions' | 'others';

export const REMOTE_TABS: readonly { id: RemoteTab; label: string }[] = [
  { id: 'setup', label: 'Set up' },
  { id: 'devices', label: 'Devices' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'others', label: 'Other computers' },
];

export function remoteTab(chosen: RemoteTab | null, setup: boolean): RemoteTab {
  return chosen ?? (setup ? 'setup' : 'devices');
}

export function afterSetupChange(chosen: RemoteTab | null): RemoteTab | null {
  return chosen === 'setup' ? null : chosen;
}
