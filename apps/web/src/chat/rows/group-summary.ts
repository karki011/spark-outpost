import { isMcpToolName, type CalloutKind } from '@spark-outpost/contracts';
import type { StepTimes } from '../run-projection.ts';
import {
  spanSeconds,
  type CommandItem,
  type GroupedItem,
  type RowGroup,
  type ToolItem,
} from './turn-rows.ts';

export type GroupKind = 'run' | 'edit' | 'read' | 'search' | 'tool';

interface Counted {
  kind: GroupKind | CalloutKind | 'thought';
  count: number;
}

function stepKind(item: GroupedItem): Counted['kind'] {
  if (item.kind === 'tool' && item.callout) return item.callout.kind;
  if (item.kind === 'command' && isMcpToolName(item.command.command)) return 'tool';
  if (item.kind === 'tool' && item.tone === 'tool') return 'tool';
  if (item.kind === 'command' || item.kind === 'thought') {
    return item.kind === 'command' ? 'run' : 'thought';
  }
  return item.tone === 'run' || item.tone === 'edit' || item.tone === 'read' ? item.tone : 'search';
}

function fileCount(items: readonly ToolItem[]): number {
  return new Set(items.map((item) => item.path ?? item.target ?? item.key)).size;
}

function times(count: number): string {
  return count === 1 ? 'once' : `${count} times`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const ORDER: readonly Counted['kind'][] = [
  'run',
  'edit',
  'read',
  'search',
  'tool',
  'browser',
  'web',
  'page',
  'mac',
  'thought',
];

const CALLOUT_PHRASES: Record<CalloutKind, (count: number) => string> = {
  browser: (count) => `used the browser ${times(count)}`,
  web: (count) => `used the web ${times(count)}`,
  page: (count) => `worked on pages ${times(count)}`,
  mac: (count) => `acted in Mac apps ${times(count)}`,
};

function isCalloutKind(kind: Counted['kind']): kind is CalloutKind {
  return Object.hasOwn(CALLOUT_PHRASES, kind);
}

function counts(group: RowGroup): Counted[] {
  const byKind = (kind: Counted['kind']) => group.items.filter((item) => stepKind(item) === kind);
  const tools = (kind: Counted['kind']) =>
    byKind(kind).filter((item): item is ToolItem => item.kind === 'tool');
  return ORDER.map((kind) => {
    const counted = kind === 'edit' || kind === 'read' ? fileCount(tools(kind)) : null;
    return { kind, count: counted ?? byKind(kind).length };
  }).filter((entry) => entry.count > 0);
}

function phrase({ kind, count }: Counted): string {
  if (isCalloutKind(kind)) return CALLOUT_PHRASES[kind](count);
  if (kind === 'tool') return `used ${plural(count, 'tool')}`;
  if (kind === 'run') return `ran ${plural(count, 'command')}`;
  if (kind === 'edit') return `edited ${plural(count, 'file')}`;
  if (kind === 'read') return `read ${plural(count, 'file')}`;
  if (kind === 'search') return `searched ${times(count)}`;
  return `thought ${times(count)}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isGroupKind(kind: Counted['kind']): kind is GroupKind {
  return kind !== 'thought' && !isCalloutKind(kind);
}

export interface GroupWords {
  lead: string;
  rest: string;
  kind: GroupKind;
}

export function groupWords(group: RowGroup): GroupWords {
  const [first, ...others] = counts(group);
  const kind = first && isGroupKind(first.kind) ? first.kind : 'run';
  return {
    lead: first ? capitalized(phrase(first)) : '',
    rest: others.map((entry) => `, ${phrase(entry)}`).join(''),
    kind,
  };
}

export function groupSummary(group: RowGroup): string {
  const { lead, rest } = groupWords(group);
  return lead + rest;
}

export function groupCommands(group: RowGroup): CommandItem[] {
  return group.items.filter((item): item is CommandItem => item.kind === 'command');
}

export function failedCount(group: RowGroup): number {
  return group.items.filter(
    (item) =>
      (item.kind === 'command' && item.command.status === 'failed') ||
      (item.kind === 'tool' && item.status === 'failed'),
  ).length;
}

export function onlyEdits(group: RowGroup): boolean {
  return group.items.every((item) => item.kind === 'thought' || stepKind(item) === 'edit');
}

function itemTimes(item: GroupedItem): StepTimes {
  if (item.kind === 'thought') return item.step;
  if (item.kind === 'tool') return item;
  const { startedAt, finishedAt } = item.command;
  return {
    startedAt: Date.parse(startedAt),
    finishedAt: finishedAt === null ? undefined : Date.parse(finishedAt),
  };
}

export function groupStart(group: RowGroup): number | null {
  const items: GroupedItem[] = group.live ? [...group.items, group.live] : group.items;
  const starts = items.flatMap((item) => {
    const at = itemTimes(item).startedAt;
    return at === undefined || Number.isNaN(at) ? [] : [at];
  });
  return starts.length > 0 ? Math.min(...starts) : null;
}

export function groupSeconds(group: RowGroup): number | null {
  const known = group.items
    .map(itemTimes)
    .filter((times) => times.startedAt !== undefined && times.finishedAt !== undefined);
  return known.length > 0 ? spanSeconds(known) : null;
}
