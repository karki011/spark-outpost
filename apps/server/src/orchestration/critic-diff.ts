const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

export function patchByFile(patch: string): Map<string, string> {
  const files = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) files.set(current, lines.join('\n'));
  };
  for (const line of patch.split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      current = header[2]!;
      lines = [];
    }
    if (current !== null) lines.push(line);
  }
  flush();
  return files;
}

interface FittedPatch {
  shown: string;
  omitted: string[];
  partial: string | null;
}

function wholeLines(text: string, limit: number): string {
  const head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf('\n');
  return lastBreak > 0 ? head.slice(0, lastBreak) : head;
}

export function fitPatch(patch: string, limit: number): FittedPatch {
  const trimmed = patch.trim();
  if (trimmed.length <= limit) return { shown: trimmed, omitted: [], partial: null };
  const files = [...patchByFile(trimmed)];
  if (files.length === 0) {
    return { shown: wholeLines(trimmed, limit), omitted: [], partial: 'the diff' };
  }
  const shown: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const [path, body] of files) {
    if (used + body.length + 1 <= limit) {
      shown.push(body);
      used += body.length + 1;
    } else {
      omitted.push(path);
    }
  }
  if (shown.length > 0) return { shown: shown.join('\n'), omitted, partial: null };
  const [first, body] = files[0]!;
  return { shown: wholeLines(body, limit), omitted: omitted.slice(1), partial: first };
}

const OMITTED_SHOWN = 30;

export function omittedNote(fitted: FittedPatch): string | null {
  if (fitted.omitted.length === 0 && !fitted.partial) return null;
  const parts: string[] = [];
  if (fitted.partial) parts.push(`\`${fitted.partial}\` is shown only in part.`);
  if (fitted.omitted.length > 0) {
    const named = fitted.omitted.slice(0, OMITTED_SHOWN).map((path) => `\`${path}\``);
    const more = fitted.omitted.length - named.length;
    parts.push(
      `The diff of ${fitted.omitted.length === 1 ? 'this file' : 'these files'} is left out to keep the prompt small: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
    );
  }
  parts.push(
    'Nothing else is missing. Open those files to review them; "Files changed" lists every file.',
  );
  return parts.join(' ');
}
