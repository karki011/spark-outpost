import {
  OUTPOST_NAME_MAX,
  START_OUTPOST_TASK_MAX,
  clipAtWord,
  type StartOutpostAction,
} from '@spark-outpost/contracts';
import { storyTaskOf } from '../../persistence/outpost-stories.ts';
import { proposeAction } from '../actions/confirm.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import {
  proposalInput,
  saveProposal,
  type Proposal,
  type ProposalArgs,
} from './outpost-proposal.ts';
import type { ChatTurn } from './outpost-turn.ts';

export const STORY_CHAT_CANNOT_START =
  'This chat is a sub-task of a story, so it cannot start more chats. Answer in your reply, or ask the lead chat.';

const STARTED_NEXT =
  'The sub-chats are working now under their own modes. Each answers in the outpost, and when all have ended Spark sends this chat one wrap-up. Do not poll or wait for them; tell the user what started and end your turn.';

function actionOf(proposal: Proposal): StartOutpostAction {
  const { draft, lines, outpostName } = proposal;
  return {
    action: 'start_outpost',
    draftId: draft.id,
    outpostName: outpostName ?? (draft.body.name ?? draft.body.title).slice(0, OUTPOST_NAME_MAX),
    joining: outpostName !== null,
    title: draft.body.title,
    chats: draft.body.chats.map((chat, index) => ({
      handle: chat.handle,
      title: chat.title,
      project: lines[index]?.project ?? null,
      agentMode: chat.agentMode ?? null,
      dependsOn: chat.dependsOn ?? null,
      stacked: lines[index]?.stacked ?? false,
      task: clipAtWord(chat.task.replace(/\s+/g, ' '), START_OUTPOST_TASK_MAX),
    })),
  };
}

async function refuseStoryChat(context: SparkToolContext, turn: ChatTurn): Promise<void> {
  if (await storyTaskOf(context.deps.db, turn.conversationId)) {
    throw new SparkToolError(STORY_CHAT_CANNOT_START);
  }
}

async function start(context: SparkToolContext, args: ProposalArgs) {
  const proposal = await saveProposal(context, args, (turn) => refuseStoryChat(context, turn));
  const result = await proposeAction(context, actionOf(proposal), {
    sendsTo: null,
    declineName: 'Discard',
  });
  return {
    draft: proposal.draft.id,
    chats: proposal.lines,
    ...result,
    ...(result.outcome === 'done' ? { next: STARTED_NEXT } : {}),
  };
}

export const outpostStartTool = sparkTool({
  name: 'spark_outpost_start',
  title: 'Start sub-task chats',
  needs: 'outpost_start',
  acts: true,
  description:
    'Create and start sub-task chats now, with the same input as spark_outpost_draft: Spark creates the outpost and chats and sends each its first message. Follows your mode like other Spark actions: at once in modes that act without asking, otherwise the user confirms a card that shows the draft. Sub-chats run in modes no higher than yours; their first messages are your text, never the user’s. Use spark_outpost_draft when the user should review first.',
  input: proposalInput,
  run: (args, context) => start(context, args),
});
