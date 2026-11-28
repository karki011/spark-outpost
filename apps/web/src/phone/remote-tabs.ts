export type RemoteTab = 'setup' | 'devices' | 'permissions' | 'others';

export const REMOTE_TABS: readonly { id: RemoteTab; label: string }[] = [
  { id: 'setup', label: 'Set up' },
  { id: 'devices', label: 'Devices' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'others', label: 'Other computers' },
];

export function remoteTab(
  chosen: { tab: RemoteTab; setup: boolean } | null,
  setup: boolean,
): RemoteTab {
  if (chosen && (chosen.setup === setup || chosen.tab !== 'setup')) return chosen.tab;
  return setup ? 'setup' : 'devices';
}
