import {
  requestState,
  type OutpostAnswer,
  type OutpostExchange,
  type OutpostIntro,
  type OutpostPost,
} from '@spark-outpost/contracts';
import type { PostWithFacts } from './ports.ts';

export interface IntroView {
  body: string;
  intro: OutpostIntro;
}

export function toOutpostPost(
  found: PostWithFacts,
  answer: OutpostAnswer | null,
  introView: IntroView | null = null,
  exchanges: OutpostExchange[] = [],
): OutpostPost {
  const { post, facts } = found;
  const derived = facts ? requestState(facts) : null;
  return {
    id: post.id,
    outpostId: post.outpostId,
    kind: post.kind,
    body: introView?.body ?? post.body,
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
    exchanges: derived ? exchanges : [],
    files: post.attachmentIds.length,
    intro: introView?.intro ?? null,
  };
}
