import {
  addressees,
  requestFor,
  type OutpostPost,
  type ThreadItem,
} from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { splitQuestion } from './answer-text.ts';
import { pullOf, type OutpostPull } from './outpost-pulls.ts';
import { publishLabels } from './post-text.ts';
import { requestStatus, statusLabel, type ThreadStatus } from './request-status.ts';

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

const TITLE_MAX = 80;
const SUMMARY_MAX = 240;
const LEADING_HANDLES = /^(?:@[a-z0-9][a-z0-9-]*[\s,]*)+/i;
const BLOCK_MARKS = /^[ \t]*(?:(?:>[ \t]?)+|#{1,6}[ \t]+|[-*+][ \t]+)/gm;
const MARKS = /[*`]+|~~|(?<![\w])_+|_+(?![\w])/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

function plain(text: string): string {
  return text
    .replace(BLOCK_MARKS, '')
    .replace(LINK, '$1')
    .replace(MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function linesFor(body: string, handle: string | null): string[] {
  const lines = body.split('\n');
  const own = handle ? lines.find((line) => addressees(line, [handle]).length > 0) : undefined;
  return own === undefined ? lines : [own, ...lines];
}

export function requestTitle(
  body: string,
  handle: string | null = null,
  asked: readonly string[] = [],
): string {
  const own = handle === null ? body : requestFor(body, handle, asked);
  const first = linesFor(own, handle)
    .map((line) => plain(line.replace(LEADING_HANDLES, '')))
    .find((line) => line !== '');
  return first ? clip(first, TITLE_MAX) : 'Request';
}

export function threadStatus(post: OutpostPost, pull: OutpostPull | null): ThreadStatus {
  if (post.held) return 'held';
  return requestStatus(post.state ?? 'sent', pull?.state ?? null);
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
  asked: readonly string[] = [],
): ThreadCard {
  const pull = pullOf(post, pulls);
  const status = threadStatus(post, pull);
  return {
    post,
    status,
    pill: statusLabel(post.state ?? 'sent', status),
    title: requestTitle(post.body, post.toHandle, asked),
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

function askedByBatch(requests: readonly OutpostPost[]): Map<string, string[]> {
  const asked = new Map<string, string[]>();
  for (const request of requests) {
    if (request.batchId === null || request.toHandle === null) continue;
    asked.set(request.batchId, [...(asked.get(request.batchId) ?? []), request.toHandle]);
  }
  return asked;
}

export function threadCards(
  items: readonly ThreadItem[],
  pulls: readonly OutpostPull[],
  activityOf: (chatId: string | null) => string | undefined,
): ThreadCard[] {
  const requests = requestsOf(items);
  const asked = askedByBatch(requests);
  return requests.map((request) =>
    threadCard(
      request,
      pulls,
      activityOf(request.toConversationId),
      request.batchId === null ? [] : asked.get(request.batchId),
    ),
  );
}

function samePull(a: OutpostPull | null, b: OutpostPull | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.url === b.url &&
    a.number === b.number &&
    a.conversationId === b.conversationId &&
    a.handle === b.handle &&
    a.postId === b.postId &&
    a.state === b.state
  );
}

function sameCard(a: ThreadCard, b: ThreadCard): boolean {
  return (
    a.post === b.post &&
    a.status === b.status &&
    a.pill === b.pill &&
    a.title === b.title &&
    a.summary === b.summary &&
    a.git.branch === b.git.branch &&
    a.git.facts.length === b.git.facts.length &&
    a.git.facts.every((fact, index) => fact === b.git.facts[index]) &&
    samePull(a.pull, b.pull)
  );
}

export function reuseCards(kept: readonly ThreadCard[], next: ThreadCard[]): ThreadCard[] {
  const before = new Map(kept.map((card) => [card.post.id, card]));
  const cards = next.map((card) => {
    const earlier = before.get(card.post.id);
    return earlier && sameCard(earlier, card) ? earlier : card;
  });
  const unchanged =
    cards.length === kept.length && cards.every((card, index) => card === kept[index]);
  return unchanged ? (kept as ThreadCard[]) : cards;
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
