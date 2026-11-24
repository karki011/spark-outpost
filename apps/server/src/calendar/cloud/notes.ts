import { CALENDAR_NOTE_LINKS_MAX } from '@spark-outpost/contracts';
import { decodeEntities, htmlNotesText } from '../notes-html.ts';
import { linkFreeSnippet } from '../snippet.ts';

const LINK_MAX = 2_000;
const NOTES_MAX = 20_000;

export function notesText(description: string | undefined): string {
  if (!description) return '';
  return htmlNotesText(description).slice(0, NOTES_MAX);
}

export function notesSnippet(description: string | undefined): string {
  if (!description) return '';
  return linkFreeSnippet(htmlNotesText(description));
}

export function noteLinks(description: string | undefined): string[] {
  if (!description) return [];
  const decoded = decodeEntities(description);
  const found = decoded.match(/https:\/\/[^\s"'<>()]+/g) ?? [];
  return [...new Set(found)]
    .filter((link) => link.length <= LINK_MAX)
    .slice(0, CALENDAR_NOTE_LINKS_MAX);
}
