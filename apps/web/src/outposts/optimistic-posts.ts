import { userAddress, type OutpostDetail, type OutpostPost } from '@spark-outpost/contracts';

export interface NewPost {
  id: string;
  text: string;
  to?: string[];
  toConversationId?: string;
}

function drawn(detail: OutpostDetail, id: string, body: string, now: string): OutpostPost {
  return {
    id,
    outpostId: detail.outpost.id,
    kind: 'note',
    body,
    fromUser: true,
    fromSpark: false,
    fromConversationId: null,
    fromRunId: null,
    fromHandle: null,
    userStarted: false,
    agentStarted: false,
    held: false,
    toConversationId: null,
    toHandle: null,
    guest: false,
    waits: false,
    batchId: null,
    taskId: null,
    runId: null,
    pinnedAt: null,
    createdAt: now,
    state: null,
    reason: null,
    answer: null,
    exchanges: [],
    files: 0,
    intro: null,
  };
}

export function optimisticPosts(
  detail: OutpostDetail,
  input: NewPost,
  now: string,
  newId: () => string = () => crypto.randomUUID(),
): OutpostPost[] {
  const members = detail.outpost.members;
  const recipient = input.toConversationId
    ? members.find((member) => member.conversationId === input.toConversationId)
    : null;
  if (input.toConversationId && !recipient) return [];
  const address = recipient
    ? { kind: 'request' as const, to: [recipient.handle], body: input.text.trim() }
    : userAddress(
        input.text,
        members.map((member) => member.handle),
        input.to,
      );
  if (address.kind === 'note') return [drawn(detail, input.id, address.body, now)];
  const batchId = address.to.length > 1 ? newId() : null;
  const reason = detail.outpost.pausedAt !== null ? 'Paused' : 'Not sent yet';
  return address.to.map((handle, index) => ({
    ...drawn(detail, index === 0 ? input.id : newId(), address.body, now),
    kind: 'request',
    toHandle: handle,
    toConversationId: members.find((member) => member.handle === handle)?.conversationId ?? null,
    batchId,
    state: 'sent',
    reason,
  }));
}
