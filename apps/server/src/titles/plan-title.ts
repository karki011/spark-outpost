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

const FENCE = /^(`{3,}|~{3,})/;

function outsideFences(body: string): string[] {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const marker = FENCE.exec(line)?.[1];
    if (fence === null && marker) fence = marker;
    else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null;
    } else if (fence === null && line) kept.push(line);
  }
  return kept;
}

function candidates(body: string): string[] {
  const lines = outsideFences(body);
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
