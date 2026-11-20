import { clipAtWord } from '@spark-outpost/contracts';
import { redactSecrets } from '../audit/redact-stream.ts';

const PLAN_TITLE_LENGTH = 60;
const HEADING = /^#{1,6}\s+(.*)$/;
const TOP_HEADING = /^#\s/;
const LIST_MARK = /^(?:[-*+>]\s+|\d+[.)]\s+|\[[ xX]\]\s+)+/;
const PLAN_PREFIX = /^(?:implementation\s+|proposed\s+|the\s+)?plan\s*(?::|-|–|—)\s*/i;
const GENERIC = new Set([
  'plan',
  'the plan',
  'my plan',
  'proposed plan',
  'implementation plan',
  'plan overview',
  'overview',
  'summary',
  'context',
  'goal',
  'goals',
  'approach',
  'steps',
]);

function cleanLine(line: string): string {
  return line
    .replace(LIST_MARK, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(PLAN_PREFIX, '')
    .replace(/[\s:.。]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function usable(text: string): boolean {
  return /\p{L}/u.test(text) && text.length >= 3 && !GENERIC.has(text.toLowerCase());
}

function candidates(body: string): string[] {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const titles = lines.flatMap((line) => (TOP_HEADING.test(line) ? [line.slice(2)] : []));
  const inOrder = lines.map((line) => HEADING.exec(line)?.[1] ?? line);
  return [...titles, ...inOrder];
}

export function planTitle(body: string): string | null {
  for (const line of candidates(body)) {
    const text = cleanLine(redactSecrets(line, []));
    if (!usable(text)) continue;
    const title = clipAtWord(text, PLAN_TITLE_LENGTH);
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  return null;
}
