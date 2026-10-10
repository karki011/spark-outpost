import { isStacked, requestState, type OutpostAnswer } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { OutpostStore, PostStore, PostWithFacts, StoryStore } from './ports.ts';
import type { ReadLabels } from './read-labels.ts';
import {
  answersPreamble,
  notesPreamble,
  stackLine,
  type PreambleAnswer,
  type PreambleNote,
} from './request-prompt.ts';
import { liveBranch } from './stack-base.ts';

export interface PreambleStores {
  outpostOf: OutpostStore['outpostOf'];
  listPosts: PostStore['listPosts'];
  getPost: PostStore['getPost'];
  storyTaskOf: StoryStore['storyTaskOf'];
  answerOf(db: Queryable, request: PostWithFacts): Promise<OutpostAnswer | null>;
  markAnswersSeen(db: Queryable, postIds: readonly string[]): Promise<string[]>;
}

export interface PreambleDeps {
  db: Queryable;
  stores: PreambleStores;
  labels: ReadLabels;
}

export type PreambleTurn = Pick<RunInput, 'parentRunId' | 'outpostRequest' | 'turnTimes'> & {
  identity: Pick<RunInput['identity'], 'runId' | 'threadId'>;
};

type Finished = PreambleAnswer['state'];

const FINISHED: ReadonlySet<string> = new Set<Finished>(['answered', 'failed', 'cancelled']);

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function carryRequestLabels(deps: PreambleDeps, turn: PreambleTurn): Promise<void> {
  const request = turn.outpostRequest;
  if (!request || request.fromUser) return;
  const found = await deps.stores.getPost(deps.db, request.postId);
  if (!found || found.post.observed.length === 0) return;
  await deps.labels.recordCarried(deps.db, turn.identity.runId, found.post.observed);
}

function notesSince(
  posts: readonly PostWithFacts[],
  turn: PreambleTurn,
  joinedAt: string,
): PreambleNote[] {
  const until = time(turn.turnTimes?.startedAt);
  if (until === null) return [];
  const after = Math.max(time(turn.turnTimes?.previousStartedAt) ?? 0, time(joinedAt) ?? 0);
  return posts
    .map(({ post }) => post)
    .filter((post) => post.kind === 'note' && post.fromConversationId !== turn.identity.threadId)
    .filter((post) => {
      const at = time(post.createdAt);
      return at !== null && at > after && at <= until;
    })
    .map((post) => ({ fromHandle: post.fromHandle, fromUser: post.fromUser, body: post.body }));
}

function finishedState(found: PostWithFacts): { state: Finished; reason: string | null } | null {
  if (!found.facts) return null;
  const derived = requestState(found.facts);
  if (!FINISHED.has(derived.state)) return null;
  return { state: derived.state as Finished, reason: derived.reason };
}

function unseenAnswers(posts: readonly PostWithFacts[], chatId: string): PostWithFacts[] {
  return posts.filter(
    (found) =>
      found.post.kind === 'request' &&
      !found.post.fromUser &&
      found.post.fromConversationId === chatId &&
      found.post.answerSeenAt === null &&
      finishedState(found) !== null,
  );
}

async function answerFor(deps: PreambleDeps, found: PostWithFacts): Promise<PreambleAnswer | null> {
  const finished = finishedState(found);
  if (!finished) return null;
  const answer = finished.state === 'answered' ? await deps.stores.answerOf(deps.db, found) : null;
  return {
    postId: found.post.id,
    toHandle: found.post.toHandle,
    state: finished.state,
    reason: finished.reason,
    text: answer?.text ?? '',
    branch: answer?.branch ?? null,
    pullRequests: answer?.pullRequests ?? [],
  };
}

async function newAnswers(
  deps: PreambleDeps,
  posts: readonly PostWithFacts[],
  turn: PreambleTurn,
): Promise<PreambleAnswer[]> {
  const unseen = unseenAnswers(posts, turn.identity.threadId);
  if (unseen.length === 0) return [];
  const claimed = new Set(
    await deps.stores.markAnswersSeen(
      deps.db,
      unseen.map((found) => found.post.id),
    ),
  );
  const answers: PreambleAnswer[] = [];
  for (const found of unseen.filter((each) => claimed.has(each.post.id))) {
    const answer = await answerFor(deps, found);
    if (!answer) continue;
    answers.push(answer);
    if (found.post.runId === null) continue;
    const carried = await deps.labels.labelsOf(deps.db, found.post.runId);
    await deps.labels.recordCarried(deps.db, turn.identity.runId, carried);
  }
  return answers;
}

async function stackNote(deps: PreambleDeps, chatId: string): Promise<string | null> {
  const own = await deps.stores.storyTaskOf(deps.db, chatId);
  const parentId = own?.task.dependsOnConversationId ?? null;
  if (!own || parentId === null) return null;
  const parent = await deps.stores.storyTaskOf(deps.db, parentId);
  if (!parent || !isStacked(own, parent)) return null;
  const branch = liveBranch(parent);
  if (branch === null) return null;
  if (own.baseBranch !== null && own.baseBranch !== branch) return null;
  return stackLine({ parentHandle: parent.handle, parentBranch: branch });
}

export async function outpostPreamble(
  deps: PreambleDeps,
  turn: PreambleTurn,
): Promise<string | null> {
  if (turn.parentRunId !== null) return null;
  await carryRequestLabels(deps, turn);
  const chatId = turn.identity.threadId;
  const found = await deps.stores.outpostOf(deps.db, chatId);
  if (!found) return null;
  const posts = await deps.stores.listPosts(deps.db, found.outpost.id);
  const notes = notesSince(posts, turn, found.member.joinedAt);
  const answers = await newAnswers(deps, posts, turn);
  if (notes.some((note) => !note.fromUser)) {
    await deps.labels.recordOutpostRead(deps.db, turn.identity.runId, 'notes');
  }
  if (answers.length > 0) {
    await deps.labels.recordOutpostRead(deps.db, turn.identity.runId, 'answer');
  }
  const parts = [
    await stackNote(deps, chatId),
    notesPreamble(notes),
    answersPreamble(answers),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

export async function withOutpostPreamble<T extends PreambleTurn & Pick<RunInput, 'preamble'>>(
  deps: PreambleDeps,
  input: T,
): Promise<T> {
  const added = await outpostPreamble(deps, input);
  if (added === null) return input;
  return { ...input, preamble: [input.preamble, added].filter(Boolean).join('\n\n') };
}
