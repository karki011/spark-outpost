const NOTES_SNIPPET = 160;
const NAMES_SHOWN = 2;
const LINK = /(?:https?:\/\/|www\.)\S+/gi;
const DANGLING_LABEL = /^[^.!?]{0,40}[:\-–—]$/;

function cleanLine(line: string): string {
  return line.replace(LINK, '').replace(/\s+/g, ' ').trim();
}

export function notesSnippet(notes: string): string {
  const text = notes
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line !== '' && !DANGLING_LABEL.test(line))
    .join(' ');
  return text.length > NOTES_SNIPPET ? `${text.slice(0, NOTES_SNIPPET - 1)}…` : text;
}

export function peopleLine(names: readonly string[], count: number): string | null {
  if (names.length === 0) return count > 1 ? `${count} people` : null;
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} +${rest} more`;
  return shown.join(' and ');
}
