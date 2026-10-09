import { requestState, type OutpostAnswer, type OutpostPost } from '@spark-outpost/contracts';
import type { PostWithFacts } from './ports.ts';

export function toOutpostPost(found: PostWithFacts, answer: OutpostAnswer | null): OutpostPost {
  const { post, facts } = found;
  const derived = facts ? requestState(facts) : null;
  return {
    id: post.id,
    outpostId: post.outpostId,
    kind: post.kind,
    body: post.body,
    fromUser: post.fromUser,
    fromConversationId: post.fromConversationId,
    fromHandle: post.fromHandle,
    toConversationId: post.toConversationId,
    toHandle: post.toHandle,
    guest: post.guest,
    waits: post.waits,
    batchId: post.batchId,
    taskId: post.taskId,
    runId: post.runId,
    pinnedAt: post.pinnedAt,
    createdAt: post.createdAt,
    state: derived?.state ?? null,
    reason: derived?.reason ?? null,
    answer: derived ? answer : null,
  };
}
