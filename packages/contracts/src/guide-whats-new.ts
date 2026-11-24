import { guideLineWords } from './guide.ts';

export const WHATS_NEW_SLUG = 'whats-new';
export const WHATS_NEW_WORDS_MAX = 400;

const ENTRY_FILE = /(?:^|\/)whats-new\/((\d{4})-(\d{2})-(\d{2})-[a-z0-9-]+)\.md$/;
const ENTRY_FOLDER = /(?:^|\/)whats-new\/[^/]+$/;
const FIELD = /^([a-z]+):\s*(.*)$/;
const TABLE_HEADER = '| What changed | What to do |\n| --- | --- |';
const TABLE_HEADER_WORDS = 5;
const NOTHING_TO_DO = '—';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface WhatsNewEntry {
  name: string;
  section: string;
  change: string;
  todo: string;
}

export function isWhatsNewEntryFile(file: string): boolean {
  return ENTRY_FOLDER.test(file);
}

function dateHeading(year: string, month: string, day: string): string {
  const name = MONTHS[Number(month) - 1];
  if (!name) throw new Error(`What's new entry has no month ${month}.`);
  return `${Number(day)} ${name} ${year}`;
}

function entryFields(source: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = FIELD.exec(line.trim());
    if (match) fields[match[1]!] = match[2]!.trim();
  }
  return fields;
}

export function parseWhatsNewEntry(file: string, source: string): WhatsNewEntry {
  const named = ENTRY_FILE.exec(file);
  if (!named) {
    throw new Error(`What's new entry ${file} must be named whats-new/YYYY-MM-DD-short-name.md.`);
  }
  const fields = entryFields(source);
  if (!fields.change) throw new Error(`What's new entry ${named[1]!} has no "change:" line.`);
  return {
    name: named[1]!,
    section: fields.section || dateHeading(named[2]!, named[3]!, named[4]!),
    change: fields.change,
    todo: fields.do || NOTHING_TO_DO,
  };
}

function cell(text: string): string {
  return text.replace(/(?<!\\)\|/g, '\\|');
}

function row(entry: WhatsNewEntry): string {
  return `| ${cell(entry.change)} | ${cell(entry.todo)} |`;
}

function newestFirst(entries: readonly WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

function withinWords(entries: readonly WhatsNewEntry[], words: number): WhatsNewEntry[] {
  const kept: WhatsNewEntry[] = [];
  const sections = new Set<string>();
  let used = 0;
  for (const entry of entries) {
    const opens = sections.has(entry.section)
      ? 0
      : guideLineWords(entry.section) + TABLE_HEADER_WORDS;
    const cost = opens + guideLineWords(row(entry));
    if (used + cost > words) break;
    used += cost;
    sections.add(entry.section);
    kept.push(entry);
  }
  return kept;
}

export function whatsNewBody(
  entries: readonly WhatsNewEntry[],
  words = WHATS_NEW_WORDS_MAX,
): string {
  const sections = new Map<string, WhatsNewEntry[]>();
  for (const entry of withinWords(newestFirst(entries), words)) {
    const rows = sections.get(entry.section) ?? [];
    rows.push(entry);
    sections.set(entry.section, rows);
  }
  return [...sections]
    .map(([section, rows]) => `## ${section}\n\n${TABLE_HEADER}\n${rows.map(row).join('\n')}`)
    .join('\n\n');
}
