import { gateBeforePublish } from '../crew-flows/before-publish.ts';
import { noteEndedTurn } from '../crew-flows/trigger-events.ts';
import { userText } from '../sub-chats/user-asked.ts';
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
  publish: (turn, reply) => {
    const { deps, lease, input, append, control } = turn;
    return publishStep(deps, { lease, input, append, control, reply }, () =>
      gateBeforePublish(turn),
    );
  },
  async turnEnded({ deps, lease, input }, changed) {
    const turn = {
      workspaceId: input.workspaceId,
      conversationId: input.identity.threadId,
      runId: lease.runId,
    };
    await noteEndedTurn(deps.db, turn, changed).catch((error: unknown) =>
      console.error('Could not note the workflow triggers of a finished turn', error),
    );
  },
};
