import { needsInput, providerName, type ConversationSummary } from '@spark-outpost/contracts';
import { isRunning, rowState, type RowState } from '../conversations/row-state.ts';
import { MAC } from '../ui/shortcuts.ts';
import { isTerminalSession } from './session-line.ts';

export type PaletteGroup = 'needs' | 'working' | 'recent';

export interface PaletteEntry {
  chat: ConversationSummary;
  group: PaletteGroup;
  state: RowState;
  label: string;
  place: string;
  agent: string;
}

export const GROUP_TITLES: Record<PaletteGroup, string> = {
  needs: 'Needs you',
  working: 'Working',
  recent: 'Recent',
};

const GROUP_RANK: Record<PaletteGroup, number> = { needs: 0, working: 1, recent: 2 };

function groupOf(chat: ConversationSummary): PaletteGroup {
  if (needsInput(chat)) return 'needs';
  return isRunning(chat) ? 'working' : 'recent';
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function placeOf(chat: ConversationSummary, projectNames: ReadonlyMap<string, string>): string {
  const project = chat.projectIds.map((id) => projectNames.get(id)).find(Boolean);
  if (project) return project;
  return chat.terminal ? folderName(chat.terminal.cwd) : 'No project';
}

function agentOf(chat: ConversationSummary): string {
  if (isTerminalSession(chat)) return `${providerName(chat.terminal!.provider)} · Terminal`;
  const provider = chat.latestRun?.provider ?? chat.attention?.provider;
  return provider ? providerName(provider) : '';
}

function labelOf(chat: ConversationSummary, state: RowState): string {
  if (state.label) return state.label;
  return chat.archivedAt ? 'Archived' : 'Idle';
}

export function paletteEntry(
  chat: ConversationSummary,
  projectNames: ReadonlyMap<string, string>,
): PaletteEntry {
  const state = rowState(chat, false);
  return {
    chat,
    group: groupOf(chat),
    state,
    label: labelOf(chat, state),
    place: placeOf(chat, projectNames),
    agent: agentOf(chat),
  };
}

export function matchesEntry(entry: PaletteEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [entry.chat.title, entry.place, entry.agent, entry.label, GROUP_TITLES[entry.group]]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

function ranked(entries: readonly PaletteEntry[]): PaletteEntry[] {
  return entries.toSorted(
    (a, b) =>
      GROUP_RANK[a.group] - GROUP_RANK[b.group] || b.chat.updatedAt.localeCompare(a.chat.updatedAt),
  );
}

export function paletteEntries(
  loaded: readonly ConversationSummary[],
  found: readonly ConversationSummary[],
  projectNames: ReadonlyMap<string, string>,
  query: string,
): PaletteEntry[] {
  const entries = loaded.map((chat) => paletteEntry(chat, projectNames));
  if (query.trim() === '') return ranked(entries.filter((entry) => !entry.chat.archivedAt));
  const byId = new Map(entries.map((entry) => [entry.chat.id, entry]));
  const shown = new Set<string>();
  const matched = entries.filter((entry) => matchesEntry(entry, query));
  matched.forEach((entry) => shown.add(entry.chat.id));
  const fromSearch = found.flatMap((chat) => {
    if (shown.has(chat.id)) return [];
    shown.add(chat.id);
    return [byId.get(chat.id) ?? paletteEntry(chat, projectNames)];
  });
  return ranked([...matched, ...fromSearch]);
}

export interface PaletteSection {
  group: PaletteGroup;
  entries: { entry: PaletteEntry; index: number }[];
}

export function paletteSections(entries: readonly PaletteEntry[]): PaletteSection[] {
  const sections: PaletteSection[] = [];
  entries.forEach((entry, index) => {
    const last = sections.at(-1);
    if (last?.group === entry.group) last.entries.push({ entry, index });
    else sections.push({ group: entry.group, entries: [{ entry, index }] });
  });
  return sections;
}

export function moveActive(index: number, key: string, count: number): number {
  if (count === 0) return 0;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  return Math.min(index, count - 1);
}

export function isPaletteShortcut(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'key'>,
  mac: boolean = MAC,
): boolean {
  const modifier = mac ? event.metaKey : event.ctrlKey;
  return modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
}
