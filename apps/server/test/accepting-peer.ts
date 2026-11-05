import type { SendOutcome } from '../src/outposts/ports.ts';
import { acceptTask } from '../src/persistence/outpost-tasks.ts';
import { fakePeerAgent, type FakePeerAgent } from './fake-peer-agent.ts';
import type { TestDb } from './support.ts';

export interface AcceptingPeer extends FakePeerAgent {
  failing: Set<string>;
}

export function acceptingPeer(t: TestDb): AcceptingPeer {
  const failing = new Set<string>();
  const peer = fakePeerAgent({
    async send(request): Promise<SendOutcome> {
      if (failing.has(request.postId)) throw new Error('connection refused');
      const outcome = await acceptTask(t.db, request.toConversationId, {
        messageId: request.postId,
        contextId: request.outpostId,
        text: request.body,
      });
      if (outcome.kind === 'refused') throw new Error(outcome.why);
      return {
        accepted: outcome.kind === 'accepted',
        task: { taskId: outcome.taskId, state: 'sent', reason: null },
      };
    },
  });
  return Object.assign(peer, { failing });
}
