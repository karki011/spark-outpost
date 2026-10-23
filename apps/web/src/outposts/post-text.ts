import type { AnswerPublish, OutpostPost, RequestState } from '@spark-outpost/contracts';
import type { ChatFaceState } from '../brand/chat-face.ts';
import { countLabel } from '../ui/count-label.ts';

export const STATE_LABELS: Record<RequestState, string> = {
  sent: 'Sent',
  working: 'Working',
  needs_you: 'Needs you',
  answered: 'Answered',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const FACE_STATES: Record<RequestState, ChatFaceState> = {
  sent: 'idle',
  working: 'working',
  needs_you: 'needs_you',
  answered: 'done',
  failed: 'failed',
  cancelled: 'idle',
};

export function requestFaceState(state: RequestState): ChatFaceState {
  return FACE_STATES[state];
}

const OPEN_STATES: readonly RequestState[] = ['sent', 'working', 'needs_you'];
const COLLAPSE_LINES = 3;
const COLLAPSE_CHARS = 280;
const WEB_LINK = /^https?:\/\//i;
const PULL_NUMBER = /\/pull\/(\d+)(?:[/?#]|$)/;

export function postAnchor(postId: string): string {
  return `op-post-${postId}`;
}

export function senderName(post: OutpostPost): string {
  if (post.fromUser) return 'You';
  if (post.fromSpark) return 'Spark';
  return post.fromHandle ? `@${post.fromHandle}` : 'A removed chat';
}

export function receiverName(post: OutpostPost): string {
  return `@${post.toHandle ?? 'chat'}`;
}

export function canCancel(post: OutpostPost): boolean {
  return post.state !== null && OPEN_STATES.includes(post.state);
}

export function isLong(text: string): boolean {
  return text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES;
}

export function postTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function publishLabels(publish: AnswerPublish | null | undefined): string[] {
  if (!publish) return [];
  return [
    ...(publish.committed === null ? [] : [publish.committed ? 'Committed' : 'Not committed']),
    ...(publish.pushed === null ? [] : [publish.pushed ? 'Pushed' : 'Not pushed']),
  ];
}

export function attachedLabel(count: number): string {
  return countLabel(count, 'file');
}

export function pullNumber(url: string): number | null {
  const found = PULL_NUMBER.exec(url)?.[1];
  return found ? Number(found) : null;
}

export function webLink(url: string): string | undefined {
  return WEB_LINK.test(url) ? url : undefined;
}
