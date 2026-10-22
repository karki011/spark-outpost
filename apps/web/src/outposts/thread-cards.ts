import type { OutpostPost, ThreadItem } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { splitQuestion } from './answer-text.ts';
import { isOpenPull, pullOf, type OutpostPull } from './outpost-pulls.ts';
import { publishLabels } from './post-text.ts';

export type ThreadStatus = 'waiting' | 'working' | 'held' | 'review' | 'idle' | 'done';

export interface ThreadCard {
  post: OutpostPost;
  status: ThreadStatus;
  pill: string;
  title: string;
  summary: string | null;
  git: GitFacts;
  pull: OutpostPull | null;
}

export interface GitFacts {
  branch: string | null;
  facts: string[];
}

export const GROUP_ORDER: readonly ThreadStatus[] = [
  'waiting',
  'working',
  'held',
  'review',
  'idle',
  'done',
];

export const GROUP_LABELS: Record<ThreadStatus, string> = {
  waiting: 'Waiting on you',
  working: 'Working',
  held: 'Held',
  review: 'Ready for review',
  idle: 'Idle',
  done: 'Resolved',
};

const PILL_LABELS: Record<ThreadStatus, string> = {
  ...GROUP_LABELS,
  done: 'Done',
};

const TITLE_MAX = 80;
const SUMMARY_MAX = 240;
const LEADING_HANDLES = /^(?:@[a-z0-9][a-z0-9-]*[\s,]*)+/i;
const MARKS = /[*`#>]+|~~|(?<![\w])_+|_+(?![\w])/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

function plain(text: string): string {
  return text.replace(LINK, '$1').replace(MARKS, '').replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function requestTitle(body: string): string {
  const first = body
    .split('\n')
    .map((line) => plain(line.replace(LEADING_HANDLES, '')))
    .find((line) => line !== '');
  return first ? clip(first, TITLE_MAX) : 'Request';
}

function answeredStatus(pull: OutpostPull | null): ThreadStatus {
  if (pull === null) return 'idle';
  return isOpenPull(pull) ? 'review' : 'done';
}

export function threadStatus(post: OutpostPost, pull: OutpostPull | null): ThreadStatus {
  if (post.held) return 'held';
  switch (post.state ?? 'sent') {
    case 'needs_you':
    case 'failed':
      return 'waiting';
    case 'working':
    case 'sent':
      return 'working';
    case 'cancelled':
      return 'done';
    case 'answered':
      return answeredStatus(pull);
  }
}

function pillOf(post: OutpostPost, status: ThreadStatus): string {
  const state = post.state ?? 'sent';
  if (status === 'held') return 'Held';
  if (state === 'failed') return 'Failed';
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'sent') return 'Queued';
  return PILL_LABELS[status];
}

function answerSummary(text: string): string | null {
  const said = plain(splitQuestion(text).said);
  return said === '' ? null : clip(said, SUMMARY_MAX);
}

export function cardSummary(post: OutpostPost, activity?: string): string | null {
  const state = post.state ?? 'sent';
  if (state === 'working') return activity ?? null;
  if (state === 'answered') return answerSummary(post.answer?.text ?? '');
  if (state === 'needs_you') return post.reason ?? answerSummary(post.answer?.text ?? '');
  if (state === 'cancelled') return null;
  return post.reason;
}

export function gitLine(post: OutpostPost, pull: OutpostPull | null): GitFacts {
  const answer = post.answer;
  if (!answer) return { branch: null, facts: [] };
  const facts = [
    ...publishLabels(answer.publish),
    ...(answer.changes.length > 0 ? [countLabel(answer.changes.length, 'file')] : []),
    ...(pull?.number ? [`PR #${pull.number}`] : []),
  ];
  return { branch: answer.branch, facts };
}

export function threadCard(
  post: OutpostPost,
  pulls: readonly OutpostPull[],
  activity?: string,
): ThreadCard {
  const pull = pullOf(post, pulls);
  const status = threadStatus(post, pull);
  return {
    post,
    status,
    pill: pillOf(post, status),
    title: requestTitle(post.body),
    summary: cardSummary(post, activity),
    git: gitLine(post, pull),
    pull,
  };
}

export function requestsOf(items: readonly ThreadItem[]): OutpostPost[] {
  return items.flatMap((item) => {
    if (item.kind === 'request') return [item.post];
    if (item.kind === 'batch') return item.lines.map((line) => line.post);
    return [];
  });
}

export function groupCards(
  cards: readonly ThreadCard[],
): { status: ThreadStatus; cards: ThreadCard[] }[] {
  return GROUP_ORDER.map((status) => ({
    status,
    cards: cards.filter((card) => card.status === status).reverse(),
  })).filter((group) => group.cards.length > 0);
}

export function waitsOnYou(cards: readonly ThreadCard[]): number {
  return cards.filter((card) => card.status === 'waiting').length;
}
