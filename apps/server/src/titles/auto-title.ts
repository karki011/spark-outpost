import path from 'node:path';
import {
  categoryLabel,
  type Category,
  type TitleOrigin,
  type TitleSource,
} from '@spark-outpost/contracts';
import { namedFiles } from '../orchestration/context.ts';

const TOPIC_WORDS = 3;
const STOP_WORDS = new Set(
  'a add an and are can change could debug did do does explain fix for from have how i in is it make me my of on or please refactor review should tell the this to update we what when where which why will with would write you your'.split(
    ' ',
  ),
);

function topicOf(request: string): string | null {
  const file = namedFiles([request])[0];
  if (file) return path.basename(file);
  const words = request
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return words.length > 0 ? words.slice(0, TOPIC_WORDS).join(' ') : null;
}

export function fallbackTitle(category: Category | null, request: string): string | null {
  if (!category || category === 'chat') return null;
  const topic = topicOf(request);
  return topic ? `${categoryLabel(category)} · ${topic}` : null;
}

export interface TitleState {
  title: string;
  source: TitleSource;
  category: Category | null;
}

export interface TurnTitle {
  suggested: string | null;
  category: Category | null;
  request: string;
}

export interface AutoTitle {
  title: string;
  origin: TitleOrigin;
  category: Category | null;
}

function taskChanged(before: Category | null, now: Category | null): boolean {
  if (!before || !now || now === 'chat') return false;
  return before !== now;
}

export function decideAutoTitle(state: TitleState, turn: TurnTitle): AutoTitle | null {
  if (state.source === 'user') return null;
  if (state.source === 'auto' && !taskChanged(state.category, turn.category)) return null;
  const fallback = turn.suggested ? null : fallbackTitle(turn.category, turn.request);
  const title = turn.suggested ?? fallback;
  if (!title || title === state.title) return null;
  return { title, origin: turn.suggested ? 'agent' : 'fallback', category: turn.category };
}
