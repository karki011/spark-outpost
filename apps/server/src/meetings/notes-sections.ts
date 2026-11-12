import {
  MEETING_SPEAKER_LABELS,
  type MeetingLine,
  type MeetingSpeaker,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { linesAfter } from './store.ts';

export const SECTION_WORDS = 6_000;
const PAGE = 500;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function renderLine(line: { speaker: MeetingSpeaker; text: string }): string {
  return `${MEETING_SPEAKER_LABELS[line.speaker]}: ${line.text}`;
}

export function cutSections(
  lines: readonly Pick<MeetingLine, 'speaker' | 'text'>[],
  sectionWords = SECTION_WORDS,
): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const line of lines) {
    const rendered = renderLine(line);
    const size = wordCount(rendered);
    if (current.length > 0 && words + size > sectionWords) {
      sections.push(current.join('\n'));
      current = [];
      words = 0;
    }
    current.push(rendered);
    words += size;
  }
  if (current.length > 0) sections.push(current.join('\n'));
  return sections;
}

export async function readSections(db: Queryable, meetingId: string): Promise<string[]> {
  const lines: MeetingLine[] = [];
  let after = 0;
  for (;;) {
    const page = await linesAfter(db, meetingId, after, PAGE);
    lines.push(...page.lines);
    const last = page.lines.at(-1);
    if (!page.more || !last) break;
    after = last.seq;
  }
  return cutSections(lines);
}
