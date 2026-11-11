import {
  REMOTE_MAC_ONLY_SWITCHES,
  REMOTE_SIGN_IN_SWITCHES,
  REMOTE_SWITCH_GROUPS,
  REMOTE_SWITCH_LABELS,
  type RemoteSwitch,
  type RemoteSwitchGroup,
  type RemoteSwitches,
} from '@spark-outpost/contracts';

export const MAC_ONLY_LINE =
  'The Browser pane, preview, shell tabs and starting a Terminal session stay on the Mac.';

export const NOTIFY_UPDATES_NOTE =
  'Sends only the chat title and "Finished" or "Failed". Works only while "Notify when a chat needs you" is on.';

export const SHOWN_SWITCHES = (Object.keys(REMOTE_SWITCH_LABELS) as RemoteSwitch[]).filter(
  (id) => !REMOTE_MAC_ONLY_SWITCHES.includes(id) && !REMOTE_SIGN_IN_SWITCHES.includes(id),
);

export interface ShownGroup extends Omit<RemoteSwitchGroup, 'switches'> {
  switches: RemoteSwitch[];
}

export function shownGroups(): ShownGroup[] {
  return REMOTE_SWITCH_GROUPS.map((group) => ({
    ...group,
    switches: group.switches.filter((id) => SHOWN_SWITCHES.includes(id)),
  })).filter((group) => group.switches.length > 0);
}

export function groupCount(ids: readonly RemoteSwitch[], switches: RemoteSwitches): string {
  const on = ids.filter((id) => switches[id]).length;
  if (on === 0) return 'All off';
  if (on === ids.length) return 'All on';
  return `${on} of ${ids.length} on`;
}

export function labelsByState(switches: RemoteSwitches): { allowed: string[]; off: string[] } {
  const allowed: string[] = [];
  const off: string[] = [];
  for (const id of SHOWN_SWITCHES) {
    (switches[id] ? allowed : off).push(REMOTE_SWITCH_LABELS[id]);
  }
  return { allowed, off };
}
