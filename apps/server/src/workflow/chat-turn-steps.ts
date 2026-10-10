import { userText } from '../outposts/user-asked.ts';
import { chatPlanInput } from '../plans/chat-plan-turn.ts';
import { linkTicketForChanges } from '../tickets/chat-link.ts';
import type { ChatTurnHooks } from './chat-turn-hooks.ts';
import { writeKeptRecord } from './kept-record-writer.ts';
import { publishStep } from './publish-step.ts';

export const chatTurnSteps: ChatTurnHooks = {
  planTurn: chatPlanInput,
  async changesKept({ deps, lease, input, append }, files) {
    const { workspaceId, level } = input;
    await writeKeptRecord(
      { db: deps.db, append },
      { runId: lease.runId, workspaceId, level },
      { files: [...files] },
    );
    await linkTicketForChanges(
      deps.db,
      { workspaceId, conversationId: input.identity.threadId, request: userText(input) },
      { files: [...files] },
    );
  },
  publish: ({ deps, lease, input, append, control }, reply) =>
    publishStep(deps, { lease, input, append, control, reply }),
};
