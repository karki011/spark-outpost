import { requestState } from '@spark-outpost/contracts';
import { CHAT_SHARE_UNTRUSTED_NOTE } from '../../chat-share/digest.ts';
import type { PostWithFacts } from '../../outposts/ports.ts';
import { labelsOf, recordCarried, recordOutpostRead } from '../../outposts/read-labels.ts';
import { stillOpen } from '../../outposts/request-wait.ts';
import { requestAnswer } from '../../persistence/outpost-answers.ts';
import { markAnswersSeen } from '../../persistence/outpost-posts.ts';
import type { SparkToolContext } from '../tool.ts';
import type { ChatTurn } from './outpost-turn.ts';

const FINISHED: ReadonlySet<string> = new Set(['answered', 'failed', 'cancelled']);

export function clipped(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}… (${text.length} chars)` : text;
}

export function at(handle: string | null): string | null {
  return handle === null ? null : `@${handle}`;
}

export function authorOf({ post }: PostWithFacts): string {
  if (post.fromUser) return 'user';
  return at(post.fromHandle) ?? 'a chat that left';
}

export function postLine(found: PostWithFacts, maxChars: number) {
  const { post, facts } = found;
  const derived = facts ? requestState(facts) : null;
  return {
    post: post.id,
    kind: post.kind,
    from: authorOf(found),
    ...(post.toHandle ? { to: at(post.toHandle) } : {}),
    ...(derived ? { state: derived.state } : {}),
    ...(derived?.reason ? { reason: derived.reason } : {}),
    ...(post.pinnedAt ? { pinned: true } : {}),
    at: post.createdAt,
    text: clipped(post.body, maxChars),
  };
}

async function carryFromAnswer(
  { deps }: SparkToolContext,
  turn: ChatTurn,
  found: PostWithFacts,
): Promise<void> {
  if (found.post.runId === null || found.post.toConversationId === turn.conversationId) return;
  await recordOutpostRead(deps.db, turn.run.id, 'answer');
  await recordCarried(deps.db, turn.run.id, await labelsOf(deps.db, found.post.runId));
}

export async function requestResult(
  context: SparkToolContext,
  turn: ChatTurn,
  found: PostWithFacts,
  maxChars: number,
) {
  const { deps, scope } = context;
  const derived = found.facts ? requestState(found.facts) : null;
  const state = derived?.state ?? null;
  const answer =
    state === 'answered'
      ? await requestAnswer(deps.db, scope.workspaceId, found, { maxChars })
      : null;
  if (!stillOpen(found)) await carryFromAnswer(context, turn, found);
  const own = !found.post.fromUser && found.post.fromConversationId === turn.conversationId;
  if (own && state !== null && FINISHED.has(state)) {
    await markAnswersSeen(deps.db, [found.post.id]);
  }
  return {
    request: found.post.id,
    from: authorOf(found),
    to: at(found.post.toHandle),
    state,
    ...(derived?.reason ? { reason: derived.reason } : {}),
    ...(answer
      ? {
          answer: answer.text,
          changes: answer.changes,
          branch: answer.branch,
          pullRequests: answer.pullRequests,
          ...(answer.publish ? { sparkRecord: answer.publish } : {}),
        }
      : {}),
    untrusted: CHAT_SHARE_UNTRUSTED_NOTE,
  };
}
