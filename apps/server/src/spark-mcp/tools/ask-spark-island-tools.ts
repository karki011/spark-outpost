import { z } from 'zod';
import { ASK_SPARK_TEXT_MAX } from '@spark-outpost/contracts';
import { finishedChat, INBOX_REFUSALS, waitingCard } from '../actions/ask-spark-inbox.ts';
import { findMeeting, type MeetingOp } from '../actions/ask-spark-meetings.ts';
import { proposeAction } from '../actions/confirm.ts';
import { sparkTool, SparkToolError, uuidInput, type SparkToolContext } from '../tool.ts';
import { ACTS_NOTE, action, brief, SENT_NOTE, summary, targetChat } from './ask-spark-tools.ts';
import { chatIdInput } from './chat-tools.ts';

const MEETING_OPS: Record<'snooze' | 'dismiss' | 'join', MeetingOp> = {
  snooze: 'snooze_meeting',
  dismiss: 'dismiss_meeting',
  join: 'join_meeting',
};

const MEETING_SUMMARY: Record<MeetingOp, string> = {
  snooze_meeting: 'Snooze the alert for your next meeting by 1 minute',
  dismiss_meeting: 'Dismiss the alerts for your next meeting',
  join_meeting: 'Join your next meeting',
};

async function findOutpost(context: SparkToolContext, reference: string) {
  const { rows } = await context.deps.db.query<{ id: string; name: string }>(
    `SELECT id, name FROM outposts
     WHERE workspace_id = $1 AND (id::text = $2 OR lower(name) = lower($2))
     ORDER BY created_at DESC LIMIT 1`,
    [context.scope.workspaceId, reference.trim()],
  );
  const outpost = rows[0];
  if (!outpost) throw new SparkToolError(INBOX_REFUSALS.noOutpost);
  return outpost;
}

const postOutpostTool = sparkTool({
  name: 'spark_post_outpost',
  title: 'Post in an outpost',
  acts: true,
  assistantOnly: true,
  description: `Post into an outpost thread: a message with one @handle asks that chat; one without is a note. ${SENT_NOTE} ${ACTS_NOTE}`,
  input: {
    outpost: z.string().trim().min(1).max(200).describe('The outpost name or id.'),
    message: z.string().trim().min(1).max(ASK_SPARK_TEXT_MAX),
  },
  run: async (args, context) => {
    const outpost = await findOutpost(context, args.outpost);
    return proposeAction(
      context,
      action({
        op: 'post_outpost',
        summary: summary(`Post in “${outpost.name}”: ${brief(args.message)}`),
        outpostId: outpost.id,
        text: args.message,
      }),
    );
  },
});

const clearFinishedTool = sparkTool({
  name: 'spark_clear_finished',
  title: 'Clear a finished chat',
  acts: true,
  assistantOnly: true,
  description: `Clear a chat from Finished in the Inbox, as its ✕ does. ${ACTS_NOTE}`,
  input: { chat: chatIdInput },
  run: async (args, context) => {
    const chat = await targetChat(context, args.chat);
    if ((await finishedChat(context.deps.db, context.scope.workspaceId, chat.id)) === null) {
      throw new SparkToolError(INBOX_REFUSALS.notFinished);
    }
    return proposeAction(
      context,
      action({
        op: 'clear_finished',
        summary: summary(`Clear “${chat.title}” from Finished`),
        conversationId: chat.id,
      }),
    );
  },
});

const setAsideTool = sparkTool({
  name: 'spark_set_aside',
  title: 'Set a card aside',
  acts: true,
  assistantOnly: true,
  description: `Set another chat's waiting card aside for later, as Later in the Inbox does (card ids come from spark_attention or spark_chat). ${ACTS_NOTE}`,
  input: { card: uuidInput },
  run: async (args, context) => {
    const card = await waitingCard(context.deps.db, context.scope.workspaceId, args.card);
    return proposeAction(
      context,
      action({
        op: 'set_aside',
        summary: summary(`Set aside “${card.title}” in “${card.chatTitle}” for later`),
        approvalId: card.id,
      }),
    );
  },
});

const meetingTool = sparkTool({
  name: 'spark_meeting',
  title: 'Snooze, dismiss or join a meeting',
  acts: true,
  assistantOnly: true,
  needs: 'meetings',
  description: `Snooze the showing meeting alert by 1 minute, dismiss a meeting's alerts, or join a meeting through its allowed link (from 10 minutes before). It picks the next fitting meeting today; pass meeting, a word from its title as the user said it, when they name one. You never see meeting details. ${ACTS_NOTE}`,
  input: {
    action: z.enum(['snooze', 'dismiss', 'join']),
    meeting: z.string().trim().min(1).max(200).optional(),
  },
  run: async (args, context) => {
    const op = MEETING_OPS[args.action];
    const event = await findMeeting(context, op, args.meeting ?? null);
    return proposeAction(
      context,
      action({
        op,
        summary: MEETING_SUMMARY[op],
        meeting: { eventKey: event.key, end: event.end },
      }),
    );
  },
});

export const askSparkIslandTools = [postOutpostTool, clearFinishedTool, setAsideTool, meetingTool];
