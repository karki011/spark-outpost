import { CALENDAR_SNIPPET_MAX, clipAtWord } from '@spark-outpost/contracts';
import { splitNotes } from './notes-text.ts';

const WRAPPED_LINK = /[(<[]\s*(?:https?:\/\/|www\.)[^\s)>\]]*\s*[)>\]]/gi;
const BARE_LINK = /(?:https?:\/\/|www\.)\S+/gi;

export function linkFreeSnippet(notes: string): string {
  const prose = splitNotes(notes)
    .agenda.split(/\r?\n/)
    .map((line) => line.replace(WRAPPED_LINK, '').replace(BARE_LINK, '').replace(/\s+/g, ' '))
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
  return clipAtWord(prose, CALENDAR_SNIPPET_MAX);
}
