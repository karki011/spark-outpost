import type { ChatSettings, ProviderCapabilities } from '@spark-outpost/contracts';
import { permissionState, type PermissionRisk } from '../chat/composer/mode-summary.ts';

export interface ModeInfo {
  label: string;
  risk: PermissionRisk;
}

export function modeInfo(
  settings: ChatSettings,
  capabilities: ProviderCapabilities | undefined,
): ModeInfo {
  const state = permissionState(settings, capabilities);
  return { label: state.label, risk: state.risk };
}

export function asksFirst(info: ModeInfo): boolean {
  return info.risk === 'read' || info.risk === 'ask';
}

export function modeNote(info: ModeInfo): string {
  if (info.risk === 'read') return `${info.label} · read only`;
  return `${info.label} · ${asksFirst(info) ? 'will stop and ask' : 'runs without asking'}`;
}

export interface ModeGroups<T> {
  asking: T[];
  free: T[];
  unknown: T[];
}

export function groupByMode<T>(
  items: readonly T[],
  modeOf: (item: T) => ModeInfo | null,
): ModeGroups<T> {
  const groups: ModeGroups<T> = { asking: [], free: [], unknown: [] };
  for (const item of items) {
    const info = modeOf(item);
    if (!info) groups.unknown.push(item);
    else if (asksFirst(info)) groups.asking.push(item);
    else groups.free.push(item);
  }
  return groups;
}
