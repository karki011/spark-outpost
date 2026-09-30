export interface DockEntry {
  id: string;
  order: string;
  label: string;
}

function byAge(a: DockEntry, b: DockEntry): number {
  return a.order.localeCompare(b.order) || a.id.localeCompare(b.id);
}

export function withEntry(entries: readonly DockEntry[], entry: DockEntry): DockEntry[] {
  return [...entries.filter((known) => known.id !== entry.id), entry].sort(byAge);
}

export function withoutEntry(entries: readonly DockEntry[], id: string): DockEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

export function shownEntry(entries: readonly DockEntry[], chosen: string | null): DockEntry | null {
  return entries.find((entry) => entry.id === chosen) ?? entries[0] ?? null;
}

export function stepTo(entries: readonly DockEntry[], current: DockEntry, step: 1 | -1): string {
  const index = entries.findIndex((entry) => entry.id === current.id);
  const next = (index + step + entries.length) % entries.length;
  return entries[next]!.id;
}

export function dockAnnouncement(entries: readonly DockEntry[]): string {
  const first = entries[0];
  if (!first) return '';
  if (entries.length === 1) return `Waiting for you above the message box: ${first.label}`;
  return `${entries.length} things are waiting for you above the message box. First: ${first.label}`;
}
