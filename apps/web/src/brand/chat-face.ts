import {
  TEAMMATE_COLORS,
  nameHash,
  type TeammateColor,
  type TeammateShape,
} from '@spark-outpost/contracts';
import type { BlobExpression } from './blob-expression.ts';

export const CHAT_FACE_STATES = [
  'idle',
  'working',
  'needs_you',
  'done',
  'failed',
  'archived',
] as const;
export type ChatFaceState = (typeof CHAT_FACE_STATES)[number];

export const CHAT_FACE_SHAPES = [
  'round',
  'organic',
  'boxy',
  'nub',
  'cloud',
  'droplet',
  'hexagon',
] as const satisfies readonly TeammateShape[];

export interface ChatFaceLook {
  color: TeammateColor;
  shape: TeammateShape;
  expression: BlobExpression;
}

const EXPRESSIONS: Record<ChatFaceState, BlobExpression> = {
  idle: 'idle',
  working: 'thinking',
  needs_you: 'unsure',
  done: 'happy',
  failed: 'sad',
  archived: 'sleepy',
};

export function chatFaceSeed(chatId: string): string {
  return `chat:${chatId}`;
}

export function chatFace(chatId: string, state: ChatFaceState): ChatFaceLook {
  const hash = nameHash(chatFaceSeed(chatId));
  return {
    color: TEAMMATE_COLORS[hash % TEAMMATE_COLORS.length]!,
    shape: CHAT_FACE_SHAPES[(hash >>> 8) % CHAT_FACE_SHAPES.length]!,
    expression: EXPRESSIONS[state],
  };
}

export function isLive(state: ChatFaceState): boolean {
  return state === 'working' || state === 'needs_you';
}
